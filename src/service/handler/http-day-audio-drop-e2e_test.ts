import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { dispatchFileDrop, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { readIMessageAudio } from './import/readback.ts'
import { type StartArgs, startArgs } from './import/startArgs.ts'

const DAY = new PlainDate('2026-01-27')
const DAY_DOC = path.posix.join('time', dayFile(DAY))
const CLIPS = ['audio.caf', 'reply.CAF', 'follow-up.caf'].map((name, index) => ({
  name,
  type: 'audio/x-caf',
  text: `Synthetic turn ${index + 1}`,
}))

test(
  { name: 'CAF drops keep speaker names with their files across reordering and responsive layouts', timeout: 60000 },
  async (t) => {
    const runs: { start: StartArgs; contents: string[] }[] = []
    let listens = 0
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '---\ncreated: 2026-01-27 07:00\n---\n\n# Day\n',
        tempPrefix: 'day-audio-drop-',
        file: DAY_DOC,
        day: true,
        now: new ZonedDateTime('2026-01-27 10:00', 'America/Chicago'),
        imports: {
          read: async ({ size }) => readIMessageAudio(size, 30),
          suggestWhen: () => '2026-01-27 09:30',
          listen: async () => {
            listens++
            return null
          },
          opening: async (filePath) => `Synthetic opening of ${path.basename(filePath)}`,
          run: async function* (job, files) {
            runs.push({
              start: startArgs({ ...job, source: job.readback.source }, job.fields!, files),
              contents: await Promise.all(files.map((file) => readFile(file, 'utf8'))),
            })
            yield {
              type: 'line',
              text: 'Filed one audio conversation.',
              level: 'log',
              command: 'message:new',
              depth: 1,
            }
            return { ok: true, file: DAY_DOC }
          },
        },
      },
      async ({ page, origin, errors }) => {
        await page.route('**/day/*/schedule', (route) =>
          route.fulfill({ json: { read: false, errors: [], meetings: [] } }),
        )
        for (const count of [3, 1]) {
          await page.setViewportSize(count === 3 ? { width: 1400, height: 1000 } : { width: 390, height: 844 })
          await page.goto(`${origin}/${DAY}`)
          await page.waitForSelector('.sky-day .sky-col')
          await dispatchFileDrop(page, '.sky-day .sky-col', CLIPS.slice(0, count))
          const dialog = page.locator('.sky-confirm')
          await dialog.getByText('New iMessage Audio conversation', { exact: true }).waitFor()
          await dialog.getByRole('button', { name: 'Start', exact: true }).click()
          await dialog.getByText("Enter who's speaking in each audio file.", { exact: true }).waitFor()
          for (const [index, file] of CLIPS.slice(0, count).entries()) {
            const speaker = dialog.getByRole('combobox', { name: `Who's speaking in ${file.name}?`, exact: true })
            assert({
              given: 'a newly dropped file',
              should: 'ask for its speaker without carrying over another import',
              actual: await speaker.inputValue(),
              expected: '',
            })
            await speaker.fill(index === 1 ? 'Me' : 'Jane Doe')
            await speaker.press('Escape')
          }
          // Each clip's opening words arrive after the upload, under its name.
          await dialog
            .locator('.sky-audio-opening')
            .nth(count - 1)
            .waitFor()
          if (count === 1) {
            await dialog.getByRole('button', { name: 'Start', exact: true }).click()
            await dialog.getByText('Enter who the message is to.', { exact: true }).waitFor()
            const to = dialog.getByRole('combobox', { name: 'Who is it to?', exact: true })
            await to.fill('Joe Smith')
            await to.press('Escape')
            await page.screenshot({ path: '/tmp/sky-audio-one-clip-phone.png', fullPage: true })
          }
          if (count === 3) {
            await dialog.getByRole('button', { name: 'Move follow-up.caf up', exact: true }).click()
            await page.setViewportSize({ width: 390, height: 844 })
            await page.waitForSelector('.sky-confirm.sky-sheet')
            assert({
              given: 'three clips dropped together, with the last moved up',
              should: 'show one conversation in the chosen order and fit the phone viewport',
              actual: [
                await dialog.locator('.sky-audio-file > span').allTextContents(),
                await dialog.locator('.sky-audio-opening').allTextContents(),
                await dialog
                  .locator('.sky-audio-files input')
                  .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
                await dialog.getByRole('button', { name: 'Meeting', exact: true }).count(),
                await dialog
                  .locator('.sky-confirm-files')
                  .evaluate((element) => element.getBoundingClientRect().right <= innerWidth),
              ],
              expected: [
                ['audio.caf', 'follow-up.caf', 'reply.CAF'],
                ['audio.caf', 'follow-up.caf', 'reply.CAF'].map((name) => `Starts: “Synthetic opening of ${name}”`),
                ['Jane Doe', 'Jane Doe', 'Me'],
                0,
                true,
              ],
            })
            await page.screenshot({ path: '/tmp/sky-audio-turns-phone.png', fullPage: true })
          }
          await dialog.getByRole('button', { name: 'Start', exact: true }).click()
          await page.waitForSelector('.sky-filed-doc')
          await dialog.waitFor({ state: 'detached' })
        }
        assert({
          given: 'a group drop and a single-file drop',
          should: 'start exactly one audio message per drop, with the group ordered and no classifier',
          actual: [
            runs.map(({ start, contents }) => [
              start.command,
              start.args.medium,
              (start.args.fromAudioTurns as string[]).map((file) => path.basename(file)),
              start.args.audioSpeakers,
              start.args.to,
              contents,
            ]),
            listens,
            await page.locator('.sky-confirm').count(),
            errors,
          ],
          expected: [
            [
              [
                'message:new',
                'iMessage Audio',
                ['audio.caf', 'follow-up.caf', 'reply.CAF'],
                ['Jane Doe', 'Jane Doe', 'Me'],
                undefined,
                [CLIPS[0].text, CLIPS[2].text, CLIPS[1].text],
              ],
              ['message:new', 'iMessage Audio', ['audio.caf'], ['Jane Doe'], 'Joe Smith', [CLIPS[0].text]],
            ],
            0,
            0,
            [],
          ],
        })
      },
    )
  },
)
