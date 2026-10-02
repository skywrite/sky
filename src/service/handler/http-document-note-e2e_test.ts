import { readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { notesFromDocument } from '#commands/all/notes/lib/fromDocument.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { dispatchFileDrop, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import type { ImportJob } from './import/jobs.ts'
import { readDocument } from './import/readback.ts'
import { startArgs } from './import/startArgs.ts'

const DAY = new PlainDate('2026-01-27')

test(
  { name: 'document capture supports work, archiving, current time, tags, and saved-note retry', timeout: 60000 },
  async (t) => {
    let root = ''
    let userData = ''
    let summaryCalls = 0
    let finishFirstSummary = () => {}
    const firstSummary = new Promise<void>((resolve) => {
      finishFirstSummary = resolve
    })
    const runs: ImportJob[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: `---\ncreated: 2026-01-27 07:00\n---\n# **2026-01-27**\n\n## Professional Complete\n`,
        tempPrefix: 'sky-document-web-',
        file: path.join('time', dayFile(DAY)),
        day: true,
        now: new ZonedDateTime('2026-01-29 10:00', 'America/Chicago'),
        imports: {
          read: async ({ name }) => readDocument(name),
          suggestWhen: () => '2025-06-01',
          captureWhen: () => '2026-01-29 10:00',
          run: async function* (job, files, signal) {
            runs.push(job)
            const start = startArgs({ ...job, source: job.readback.source }, job.fields!, files)
            yield { type: 'stage', id: 'save', label: 'Saving the note', detail: null, command: 'notes:new', depth: 1 }
            let markSaved = () => {}
            const saved = new Promise<void>((resolve) => {
              markSaved = resolve
            })
            const work = notesFromDocument({
              source: String(start.args.fromFile),
              summary: String(start.args.summary),
              body: String(start.args.body),
              tags: start.args.tags as string | undefined,
              when: String(start.args.workWhen),
              category: String(start.args.category),
              run: job.id,
              signal,
              config: {
                DIR_BASE: root,
                DIR_TIME: path.join(root, 'time'),
                DIR_ATTACHMENTS: path.join(userData, 'attachments'),
                DIR_USER_DATA: userData,
                DIR_STATE: path.join(root, 'state'),
              },
              stage: (id) => {
                if (id === 'summary') markSaved()
              },
              summarize: async () => {
                if (++summaryCalls === 1) {
                  await firstSummary
                  throw new Error('Synthetic timeout')
                }
                return '# Summary: Atlas report\n\n## Key points\n\nThe pilot is ready for review.'
              },
              enrich: async () => ({ tags: 'Planning' }),
            })
            await Promise.race([saved, work])
            yield {
              type: 'stage',
              id: 'summary',
              label: 'Summarizing the attachment',
              detail: null,
              command: 'notes:new',
              depth: 1,
            }
            const result = await work
            const file = result.data ? path.relative(root, result.data.filePath) : null
            return result.ok ? { ok: true, file } : { ok: false, file, message: result.message! }
          },
        },
      },
      async ({ page, origin, userDataDir, errors }) => {
        userData = userDataDir
        root = path.dirname(userDataDir)
        await page.route('**/day/*/schedule', (route) =>
          route.fulfill({ json: { read: false, errors: [], meetings: [] } }),
        )
        await page.route('**/docs/_api/complete?kind=tags&**', (route) => {
          const search = new URL(route.request().url()).searchParams.get('q')?.toLowerCase() ?? ''
          return route.fulfill({
            json: {
              items: [{ value: 'Planning', type: 'tag' }].filter((tag) => tag.value.toLowerCase().includes(search)),
            },
          })
        })
        page.on('response', async (response) => {
          if (response.status() >= 500) errors.push(`${new URL(response.url()).pathname}: ${await response.text()}`)
        })
        await page.setViewportSize({ width: 1400, height: 1000 })
        await page.goto(`${origin}/${DAY}`)
        await page.waitForSelector('.sky-day .sky-col')
        await page.getByRole('button', { name: 'Hide details', exact: true }).click()
        await dispatchFileDrop(page, '.sky-day .sky-col', {
          name: 'Atlas-report.pdf',
          type: 'application/pdf',
          text: '%PDF-1.4 synthetic report',
        })
        const dialog = page.locator('.sky-confirm')
        await dialog.getByText('Capture document', { exact: true }).waitFor()
        assert({
          given: 'a PDF dropped onto an earlier day',
          should: 'propose a neutral title, retain that day, and prefill the current time',
          actual: [
            await dialog.getByLabel('Title', { exact: true }).inputValue(),
            await dialog.getByLabel('Day', { exact: true }).inputValue(),
            await dialog.getByLabel('When', { exact: true }).inputValue(),
          ],
          expected: ['Atlas report', DAY.toString(), '10:00'],
        })
        const tags = dialog.getByLabel('Tags', { exact: true })
        await tags.fill('Pl')
        await page.getByRole('option', { name: 'Planning', exact: true }).click()
        await tags.fill('Temporary')
        await tags.press('Enter')
        await tags.press('Backspace')
        await tags.evaluate((input) => {
          const dataTransfer = new DataTransfer()
          dataTransfer.setData('text/plain', 'Reference; Strategy; Planning')
          input.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
        })
        await dialog.getByLabel('Title', { exact: true }).fill('Revised the Atlas report')
        await dialog.getByLabel('When', { exact: true }).fill('15:30 - 16:30')
        await dialog.getByLabel('Additional notes').fill('Reworked the recommendations.')
        await dialog.getByText('1 hour', { exact: true }).waitFor()
        await dialog.getByRole('button', { name: 'Add to day', exact: true }).click()
        await dialog.getByText('Summarizing the document…', { exact: true }).waitFor()
        await dialog.getByText('Your note and attachment are saved.', { exact: true }).waitFor()
        await dialog.getByText('It’s safe to close this dialog.', { exact: false }).waitFor()
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        const notesDir = path.join(root, 'time', dayDir(DAY), 'actions/notes')
        const initialNote = Document.fromMarkdown(
          await readFile(path.join(notesDir, (await readdir(notesDir))[0]), 'utf8'),
        )
        assert({
          given: 'the summarizing dialog is closed after choosing, removing, and dropping tags',
          should: 'keep working with chosen tags already saved and no permanent status card on the day',
          actual: [
            (await (await page.request.get(`${origin}/import/${runs[0].id}`)).json()).job.state,
            await page.locator('.sky-document-imports, .sky-document-status').count(),
            initialNote.yaml.tags,
          ],
          expected: ['running', 0, 'Planning; Reference; Strategy'],
        })
        await page.getByRole('link', { name: 'Revised the Atlas report', exact: true }).waitFor()
        assert({
          given: 'Add to day with the summary still running',
          should: 'stay on the day with the saved note and its duration visible',
          actual: [new URL(page.url()).pathname, await page.getByText('1 hour', { exact: true }).count()],
          expected: [`/${DAY}`, 1],
        })
        finishFirstSummary()
        await page.waitForFunction(
          async (id) => (await (await fetch(`/import/${id}`)).json()).job.state === 'failed',
          runs[0].id,
        )
        const job = (await (await page.request.get(`${origin}/import/${runs[0].id}`)).json()).job as ImportJob
        assert({
          given: 'the summary failed',
          should: 'retain an openable note and retry state',
          actual: [job.state, Boolean(job.result)],
          expected: ['failed', true],
        })
        const notice = page.locator('.sky-document-toast')
        await notice.getByText('Summary needs attention', { exact: false }).waitFor()
        await notice.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('button', { name: 'Retry summary', exact: true }).click()
        assert({
          given: 'reopening a saved document capture',
          should: 'retain its tags and lock them for retry',
          actual: [await tags.isDisabled(), await dialog.getByText('Reference', { exact: true }).count()],
          expected: [true, 1],
        })
        await dialog.getByRole('button', { name: 'Retry summary', exact: true }).click()
        await dialog.getByText('Summary ready', { exact: true }).waitFor()
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        await page.waitForFunction(
          async (id) => (await (await fetch(`/import/${id}`)).json()).job.state === 'done',
          job.id,
        )
        await page.getByText('The pilot is ready for review.', { exact: true }).waitFor({ timeout: 5000 })
        const saved = Document.fromMarkdown(await readFile(path.join(root, job.result!.file), 'utf8'))
        assert({
          given: 'retrying the summary through the web',
          should: 'finish the same note with its time, personal words, attachment, and tags',
          actual: [
            saved.yaml.summary,
            saved.yaml.when,
            saved.markdown.includes('Reworked the recommendations.'),
            saved.yaml.attachments,
            saved.yaml.tags,
            summaryCalls,
          ],
          expected: [
            'Revised the Atlas report',
            '2026-01-27 15:30 - 16:30',
            true,
            [{ file: 'Atlas-report.pdf' }],
            'Planning; Reference; Strategy',
            2,
          ],
        })

        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(`${origin}/${DAY}`)
        await page.getByRole('link', { name: 'Revised the Atlas report', exact: true }).waitFor()
        await page.locator('.sky-day .sky-head input[type=file]').setInputFiles({
          name: 'Widget-plan.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 synthetic plan'),
        })
        await dialog.getByText('Capture document', { exact: true }).waitFor()
        const chosenDay = DAY.addDays(-1).toString()
        await dialog.getByLabel('Day', { exact: true }).fill(chosenDay)
        await dialog.getByLabel('Tags', { exact: true }).fill('Archive')
        await dialog.getByRole('button', { name: 'Add to day', exact: true }).click()
        await dialog.getByText('Summary ready', { exact: true }).waitFor()
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        await page.getByRole('link', { name: 'Widget plan', exact: true }).waitFor()
        await notice.getByRole('link', { name: 'Open note', exact: true }).waitFor()
        assert({
          given: 'a document archived from the mobile dialog with a different day and an uncommitted tag',
          should: 'use the current time, save the tag, and open the chosen day with a completion popup',
          actual: [
            new URL(page.url()).pathname,
            runs.at(-1)!.fields?.when,
            Document.fromMarkdown(await readFile(path.join(root, runs.at(-1)!.result!.file), 'utf8')).yaml.tags,
            await notice.evaluate((element) => {
              const rect = element.getBoundingClientRect()
              return rect.top > window.innerHeight / 2 && rect.bottom <= window.innerHeight
            }),
          ],
          expected: [`/${chosenDay}`, `${chosenDay} 10:00`, 'Archive; Planning', true],
        })
        await notice.getByRole('button', { name: 'Dismiss summary notification', exact: true }).click()
        await page.reload()
        await page.getByRole('link', { name: 'Widget plan', exact: true }).waitFor()
        assert({
          given: 'the day is reopened after completion',
          should: 'leave the note in the record without replaying old notifications',
          actual: await notice.count(),
          expected: 0,
        })

        const kept = await page.request.put(`${origin}/day/${DAY}/files?name=Atlas-budget.pdf`, {
          data: '%PDF-1.4 synthetic budget',
          headers: { 'Content-Type': 'application/pdf' },
        })
        assert({ given: 'a kept PDF', should: 'save it to the day', actual: kept.ok(), expected: true })
        await page.goto(`${origin}/${DAY}/files`)
        await page.getByRole('button', { name: 'Create note', exact: true }).click()
        await dialog.getByText('Capture document', { exact: true }).waitFor()
        await dialog.getByLabel('When', { exact: true }).fill('17:00 - 17:30')
        await dialog.getByRole('button', { name: 'Add to day', exact: true }).click()
        await dialog.getByText('Summary ready', { exact: true }).waitFor()
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        await page.getByRole('link', { name: /Atlas budget/ }).waitFor()
        await notice.getByRole('link', { name: 'Open note', exact: true }).waitFor()
        const listing = await (await page.request.get(`${origin}/day/${DAY}/files`)).json()
        assert({
          given: 'desktop drop, retry, mobile picker, and a kept attachment',
          should: 'reuse the kept attachment and complete without browser errors',
          actual: [runs.length, listing.files.length, errors],
          expected: [4, 2, []],
        })
      },
    )
  },
)
