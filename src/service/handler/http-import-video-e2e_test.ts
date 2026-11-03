import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dispatchFileDrop, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import type { ImportJob } from './import/jobs.ts'
import { readSrt, readText, readVideo } from './import/readback.ts'
import { startArgs } from './import/startArgs.ts'

const DAY = new PlainDate('2031-04-05')
const DAY_DOC = path.posix.join('time', dayFile(DAY))
const IDS = ['11111111111111111111111111111111', '22222222222222222222222222222222', '33333333333333333333333333333333']
const SRT = '1\n00:00:00,000 --> 00:00:03,000\nHello Atlas team, here is the complete demonstration.\n'
const LABEL = 'Accept all reviews for the selected videos'

test(
  {
    name: 'video pairs share a scoped review choice, retain edits after errors, and keep meaningful page titles',
    timeout: 60000,
  },
  async (t) => {
    const jobs: ImportJob[] = []
    const commands: ReturnType<typeof startArgs>[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: `---\ncreated: ${DAY.ymd} 07:00\n---\n\n# Day\n`,
        file: DAY_DOC,
        day: true,
        tempPrefix: 'import-video-',
        imports: {
          read: async (file) =>
            file.name.endsWith('.mp4')
              ? readVideo(90)
              : file.name.endsWith('.srt')
                ? readSrt(await readFile(file.path, 'utf8'), file.name)
                : readText(await readFile(file.path, 'utf8'), file.name),
          run: async function* (job, files) {
            jobs.push(job)
            commands.push(startArgs({ ...job, source: job.readback.source }, job.fields!, files))
            yield {
              type: 'line',
              text: 'Completed the synthetic video import.',
              level: 'log',
              command: 'video:new',
              depth: 1,
            }
            return { ok: true, file: DAY_DOC }
          },
        },
      },
      async ({ page, origin, errors }) => {
        let releaseDay!: () => void
        const dayReady = new Promise<void>((resolve) => (releaseDay = resolve))
        await page.route(`${origin}/day/${DAY.ymd}`, async (route) => {
          await dayReady
          await route.continue()
        })
        await page.route('**/day/*/schedule', (route) =>
          route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
        )
        await page.setViewportSize({ width: 1400, height: 1000 })
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.waitForSelector('.sky-day .sky-col')
        await dispatchFileDrop(
          page,
          '.sky-day .sky-col',
          IDS.flatMap((id, i) => [
            { name: `Atlas-${id}.mp4`, type: 'video/mp4', text: 'synthetic video bytes' },
            {
              name: `Atlas-${id}.${i === 1 ? 'txt' : 'srt'}`,
              type: 'text/plain',
              text: i === 1 ? 'Hello Atlas team, here is the complete demonstration.' : SRT,
            },
          ]),
        )
        for (let i = 0; i < 3; i++) {
          const url = `https://www.loom.com/share/${IDS[i]}`
          await page.getByLabel('Source video URL', { exact: true }).waitFor()
          await page.waitForFunction(
            (expected) =>
              document.querySelector<HTMLInputElement>('input[value="' + expected + '"]')?.value === expected,
            url,
          )
          if (i === 0) {
            // Finish loading the covered page after the dialog claims the tab title.
            releaseDay()
            await page.locator('.sky-day .sky-title').filter({ hasText: 'Saturday, April 5, 2031' }).waitFor()
            await page.getByRole('checkbox', { name: LABEL }).check()
            await page.getByLabel('Source video URL', { exact: true }).fill('')
            await page.getByRole('button', { name: 'Start', exact: true }).click()
            await page
              .getByText('Enter the source video URL so Sky can find an existing entry or create the right video.', {
                exact: true,
              })
              .waitFor()
            await page.getByLabel('Source video URL', { exact: true }).fill(url)
          }
          assert({
            given: `selected video ${i + 1}`,
            should: 'keep the batch approval choice and source identity',
            actual: [
              await page.getByRole('checkbox', { name: LABEL }).isChecked(),
              await page.getByLabel('Source video URL', { exact: true }).inputValue(),
              await page.title(),
            ],
            expected: [true, url, `sky · Import Atlas-${IDS[i]}`],
          })
          await page.locator('input[aria-label="When"]').fill(`${DAY.ymd} 09:30`)
          await page.getByRole('button', { name: 'Start', exact: true }).click()
          await page.waitForFunction(
            () => ![...document.querySelectorAll('button')].some((button) => button.textContent === 'Starting…'),
          )
        }
        await page.getByLabel('Source video URL', { exact: true }).waitFor({ state: 'hidden' })
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.waitForSelector('.sky-day button[aria-label="Add a file"]:not([disabled])')
        const freshId = '44444444444444444444444444444444'
        await dispatchFileDrop(page, '.sky-day .sky-col', [
          { name: `Other-${freshId}.mp4`, type: 'video/mp4', text: 'synthetic video bytes' },
          { name: `Other-${freshId}.srt`, type: 'text/plain', text: SRT },
        ])
        await page.getByRole('checkbox', { name: LABEL }).waitFor()
        assert({
          given: 'a separate file selection',
          should: 'require its own review choice',
          actual: await page.getByRole('checkbox', { name: LABEL }).isChecked(),
          expected: false,
        })
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page.waitForFunction(() => document.title === 'sky · Saturday, April 5, 2031 · Day record')
        await page.goto(`${origin}/import/${jobs[0].id}`)
        await page.waitForFunction((title) => document.title === title, `sky · ${jobs[0].title}`)
        await page.goto(`${origin}/import/${jobs[1].id}`)
        await page.waitForFunction((title) => document.title === title, `sky · ${jobs[1].title}`)
        await page.goBack()
        await page.waitForFunction((title) => document.title === title, `sky · ${jobs[0].title}`)
        await page.goForward()
        await page.waitForFunction((title) => document.title === title, `sky · ${jobs[1].title}`)
        assert({
          given: 'three source pairs started from the browser',
          should: 'run the shared video command with both files and scoped approval, without browser errors',
          actual: [
            commands.map((command) => ({
              name: command.command,
              approval: command.args.acceptAllReviews,
              video: typeof command.args.videoFile,
              source: typeof (command.args.fromSrt ?? command.args.fromText),
            })),
            errors.filter((error) => !error.includes('status of 400 (Bad Request)')),
          ],
          expected: [IDS.map(() => ({ name: 'video:new', approval: true, video: 'string', source: 'string' })), []],
        })
      },
    )
  },
)
