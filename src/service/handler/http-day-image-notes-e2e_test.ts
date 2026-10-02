import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { notesFromDocument } from '#commands/all/notes/lib/fromDocument.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { dispatchFileDrop, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import type { ImportJob } from './import/jobs.ts'
import { readImage } from './import/readback.ts'
import { startArgs } from './import/startArgs.ts'

const DAY = new PlainDate('2026-01-27')
const TEXT =
  '## Atlas plan\n\n- [ ] Ship Widget-V2\n- [x] Review scope\n\n| Item | Count |\n| --- | --- |\n| Widgets | 12 |\n\n[illegible]'

test(
  {
    name: 'day image notes preserve capture choices, save before reading, and retry on desktop and phone',
    timeout: 60000,
  },
  async (t) => {
    let root = ''
    let userData = ''
    let reads = 0
    let failFirstRead = () => {}
    const firstRead = new Promise<void>((resolve) => {
      failFirstRead = resolve
    })
    const runs: ImportJob[] = []
    const originals: string[][] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '---\ncreated: 2026-01-27 07:00\n---\n\n# Day\n\n## Professional Complete\n',
        tempPrefix: 'sky-image-notes-web-',
        file: path.join('time', dayFile(DAY)),
        day: true,
        now: new ZonedDateTime('2026-01-29 10:00', 'America/Chicago'),
        imports: {
          read: async ({ size }) => readImage(size, { width: 1200, height: 2400 }),
          suggestWhen: () => '2025-06-01 08:00',
          captureWhen: () => '2026-01-29 10:00',
          run: async function* (job, files, signal) {
            runs.push(job)
            const start = startArgs({ ...job, source: job.readback.source }, job.fields!, files)
            let markSaved = () => {}
            const saved = new Promise<void>((resolve) => {
              markSaved = resolve
            })
            const work = notesFromDocument({
              source: String(start.args.fromImage).split(','),
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
                throw new Error('Image notes must use the text reader')
              },
              transcribe: async (attachments) => {
                originals.push(await Promise.all(attachments.map((file) => readFile(file, 'utf8'))))
                if (++reads === 1) {
                  await firstRead
                  throw new Error('Synthetic read timeout')
                }
                return { title: 'Atlas launch plan and widget counts', body: TEXT }
              },
              enrich: async () => ({ tags: 'Planning' }),
            })
            await Promise.race([saved, work])
            yield {
              type: 'stage',
              id: 'summary',
              label: 'Reading the image text',
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
        root = path.dirname(userDataDir)
        userData = userDataDir
        await page.route('**/day/*/schedule', (route) =>
          route.fulfill({ json: { read: false, errors: [], meetings: [] } }),
        )
        for (const [index, viewport] of [
          { width: 1400, height: 1000 },
          { width: 390, height: 844 },
        ].entries()) {
          await page.setViewportSize(viewport)
          await page.goto(`${origin}/${DAY}`)
          await page.waitForSelector('.sky-day button[aria-label="Add a file"]:not([disabled])')
          const title = await page.title()
          if (index === 0) {
            await dispatchFileDrop(page, '.sky-day .sky-col', [
              { name: 'Atlas-1.png', type: 'image/png', text: 'synthetic page 1', lastModified: 1_700_000_000_000 },
              { name: 'Atlas-2.heic', type: 'image/heic', text: 'synthetic page 2', lastModified: 1_700_000_060_000 },
            ])
          } else {
            await page.getByRole('button', { name: 'Add a file', exact: true }).click()
            await page.locator('input[type="file"][accept*=".vtt"]').setInputFiles({
              name: 'Atlas-3.jpg',
              mimeType: 'image/jpeg',
              buffer: Buffer.from('synthetic page 3'),
            })
          }
          const dialog = page.locator('.sky-confirm')
          await dialog.getByRole('button', { name: 'Notes', exact: true }).waitFor()
          await dialog.getByLabel('When', { exact: true }).fill('2026-01-27 12:00')
          await dialog.getByRole('button', { name: 'Notes', exact: true }).click()
          assert({
            given: `an image chosen as notes at ${viewport.width}px`,
            should: 'keep the viewed day and prefill the current time independently of the image clock',
            actual: [
              await dialog.getByLabel('Day', { exact: true }).inputValue(),
              await dialog.getByLabel('When', { exact: true }).inputValue(),
            ],
            expected: [DAY.toString(), '10:00'],
          })
          const activity = `Planned Atlas ${index + 1}`
          await dialog.getByLabel('Title', { exact: true }).fill(activity)
          await dialog.getByLabel('When', { exact: true }).fill('15:30 - 16:30')
          await dialog.getByLabel('Additional notes').fill('Reviewed the scope.')
          await dialog.getByRole('button', { name: 'Message', exact: true }).click()
          assert({
            given: 'switching back to Message',
            should: 'retain its edited time',
            actual: await dialog.getByLabel('When', { exact: true }).inputValue(),
            expected: '2026-01-27 12:00',
          })
          await dialog.getByRole('button', { name: 'Notes', exact: true }).click()
          assert({
            given: 'switching back to Notes',
            should: 'preserve the activity, range, and additional notes',
            actual: [
              await dialog.getByLabel('Title', { exact: true }).inputValue(),
              await dialog.getByLabel('When', { exact: true }).inputValue(),
              await dialog.getByLabel('Additional notes').inputValue(),
            ],
            expected: [activity, '15:30 - 16:30', 'Reviewed the scope.'],
          })
          await dialog.getByRole('button', { name: 'Add to day', exact: true }).click()
          if (index === 0) {
            await dialog.getByText('Reading the image text…', { exact: true }).waitFor()
            await dialog.getByText('Your note and attachments are saved.', { exact: true }).waitFor()
            await dialog.getByRole('button', { name: 'Close', exact: true }).click()
            await dialog.waitFor({ state: 'detached' })
            await page.getByRole('link', { name: activity, exact: true }).waitFor()
            assert({
              given: 'closing while the image reader works',
              should: 'stay on the day and preserve its page title',
              actual: [new URL(page.url()).pathname, await page.title()],
              expected: [`/${DAY}`, title],
            })
            failFirstRead()
            await page.locator('.sky-document-toast[data-failed="true"]').waitFor()
            await page.locator('.sky-document-toast').getByRole('button', { name: 'View', exact: true }).click()
            await page.getByRole('button', { name: 'Retry reading', exact: true }).click()
            await dialog.getByRole('button', { name: 'Retry reading', exact: true }).waitFor()
            assert({
              given: 'reopening a failed image note',
              should: 'lock its capture details for retry',
              actual: [
                await dialog.getByLabel('Title', { exact: true }).isDisabled(),
                await dialog.getByRole('button', { name: 'Message', exact: true }).isDisabled(),
              ],
              expected: [true, true],
            })
            await dialog.getByRole('button', { name: 'Retry reading', exact: true }).click()
          }
          await dialog.getByText('Notes ready', { exact: true }).waitFor()
          const previousPath = new URL(page.url()).pathname
          const previousTitle = await page.title()
          await dialog.getByRole('link', { name: 'Open note', exact: true }).click()
          await page.waitForSelector('.sky-doc-body')
          await page.getByRole('heading', { name: 'Atlas plan', exact: true }).waitFor()
          const completed = (await (await page.request.get(`${origin}/import/${runs.at(-1)!.id}`)).json())
            .job as ImportJob
          const markdown = Document.fromMarkdown(await readFile(path.join(root, completed.result!.file), 'utf8'))
          assert({
            given: 'opening the completed image note',
            should: 'render the original structured text, retain attachments, and title the page for this note',
            actual: [
              markdown.markdown.includes(TEXT),
              markdown.yaml.when,
              markdown.attachments.length,
              markdown.attachments.every(({ file }) =>
                /^\d{4}-\d{2}-\d{2}_\d{6}_Atlas-launch-plan-and-widget-counts(?:-[12])?\.(png|heic|jpg)$/.test(file),
              ),
              await page.locator('.sky-doc-body table').count(),
              (await page.title()).includes(activity),
            ],
            expected: [true, '2026-01-27 15:30 - 16:30', index === 0 ? 2 : 1, true, 1, true],
          })
          const noteTitle = await page.title()
          await page.reload()
          await page.getByRole('heading', { name: 'Atlas plan', exact: true }).waitFor()
          assert({
            given: 'loading the image note directly',
            should: 'keep its specific page title',
            actual: await page.title(),
            expected: noteTitle,
          })
          await page.goBack()
          await page.waitForSelector(index === 0 ? '.sky-import .sky-title' : '.sky-day .sky-col')
          await page.waitForFunction((title) => document.title === title, previousTitle)
          assert({
            given: 'browser back to the day or import that opened the note',
            should: 'restore that screen and its title',
            actual: [new URL(page.url()).pathname, await page.title()],
            expected: [previousPath, previousTitle],
          })
          await page.goForward()
          await page.waitForSelector('.sky-doc-body')
          await page.waitForFunction((title) => document.title === title, noteTitle)
          assert({
            given: 'browser forward to the image note',
            should: 'restore its title',
            actual: await page.title(),
            expected: noteTitle,
          })
        }
        assert({
          given: 'a grouped desktop capture, its retry, and a phone capture',
          should: 'read the retained images with no browser errors',
          actual: [originals, errors],
          expected: [
            [['synthetic page 1', 'synthetic page 2'], ['synthetic page 1', 'synthetic page 2'], ['synthetic page 3']],
            [],
          ],
        })
      },
    )
  },
)
