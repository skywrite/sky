// A temp notebook and scripted command verify the screenshot drop without an AI call.
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dispatchFileDrop, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { readImage } from './import/readback.ts'
import { type StartArgs, startArgs } from './import/startArgs.ts'

const DAY = new PlainDate('2026-08-05')
const DAY_DOC = path.posix.join('time', dayFile(DAY))
const SCREENSHOTS = ['Atlas-1.png', 'Atlas-2.jpg', 'Atlas-3.webp', 'Atlas-4.PNG'].map((name, index) => ({
  name,
  type: name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.webp') ? 'image/webp' : 'image/png',
  text: `screenshot ${index + 1}`,
  lastModified: 1_700_000_000_000 + index * 60_000,
}))

test({ name: 'day — four dropped screenshots become one message on desktop and phone', timeout: 60000 }, async (t) => {
  const runs: { start: StartArgs; contents: string[] }[] = []
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: '---\ncreated: 2026-08-05 07:00\n---\n\n# Day\n',
      tempPrefix: 'day-images-drop-',
      file: DAY_DOC,
      day: true,
      imports: {
        read: async ({ size }) => readImage(size, { width: 1200, height: 2400 }),
        run: async function* (job, files) {
          if (!job.fields) throw new Error('Missing import fields')
          runs.push({
            start: startArgs({ ...job, source: job.readback.source }, job.fields, files),
            contents: await Promise.all(files.map((file) => readFile(file, 'utf8'))),
          })
          yield { type: 'line', text: 'Filed one message.', level: 'log', command: 'message:new', depth: 1 }
          return { ok: true, file: DAY_DOC }
        },
      },
    },
    async ({ page, origin, errors }) => {
      const jobs = async () => (await (await page.request.get(`${origin}/import`)).json()).imports as unknown[]
      for (const viewport of [
        { width: 1400, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport)
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.waitForSelector('.sky-day button[aria-label="Add a file"]:not([disabled])')
        const before = (await jobs()).length
        await dispatchFileDrop(page, '.sky-day .sky-col', SCREENSHOTS)
        await page.waitForSelector('.sky-confirm-title:has-text("New message from 4 screenshots")')
        assert({
          given: `four screenshots dropped on Today at ${viewport.width}px`,
          should: 'list every file, say they become one message, and create only one import',
          actual: [
            await page.locator('.sky-confirm-files li span:first-child').allTextContents(),
            await page.textContent('.sky-confirm-read'),
            await page.textContent('.sky-confirm-next'),
            (await jobs()).length - before,
            await page
              .locator('.sky-confirm-files')
              .evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth),
          ],
          expected: [
            SCREENSHOTS.map((file) => file.name),
            '4 screenshots → 1 message',
            'Sky reads all 4 screenshots as one conversation, checks what it read with you, and files one message under the day.',
            1,
            true,
          ],
        })
        await page.getByRole('button', { name: 'Start', exact: true }).click()
        await page.waitForSelector('.sky-filed-doc')
        await page.waitForSelector('.sky-confirm', { state: 'detached' })
      }
      assert({
        given: 'Start on desktop and phone',
        should: 'run one message command per drop with all four images and no queued extra imports',
        actual: [
          runs.map(({ start, contents }) => ({
            command: start.command,
            files: String(start.args.fromImage)
              .split(',')
              .map((file) => path.basename(file)),
            contents,
          })),
          await page.locator('.sky-confirm').count(),
          errors,
        ],
        expected: [
          [1, 2].map(() => ({
            command: 'message:new',
            files: SCREENSHOTS.map((file) => file.name),
            contents: SCREENSHOTS.map((file) => file.text),
          })),
          0,
          [],
        ],
      })
    },
  )
})
