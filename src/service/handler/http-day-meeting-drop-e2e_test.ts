// Run with `bun test service/handler/http-day-meeting-drop-e2e_test.ts`.
// A temp notebook and scripted imports exercise the browser without an AI call.
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dispatchFileDrag, dispatchFileDrop, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { readAudio, readTranscript } from './import/readback.ts'
import { type StartArgs, startArgs } from './import/startArgs.ts'

const DAY = new PlainDate('2026-08-05')
const DAY_DOC = path.posix.join('time', dayFile(DAY))
const TRANSCRIPT = 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n<v Jane Doe>Let us review the Atlas plan.\n'
const ROW = '.sky-rail [data-section="meetings"] [data-meeting-drop]'
const SECTION = '.sky-rail [data-meetings-drop]'

test(
  { name: 'day — drop on an unrecorded meeting highlights the row and imports at its time', timeout: 60000 },
  async (t) => {
    const runs: StartArgs[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '---\ncreated: 2026-08-05 07:00\n---\n\n# Day\n\n## Most important\n\n- Ship the Atlas deck\n',
        tempPrefix: 'day-meeting-drop-',
        file: DAY_DOC,
        day: true,
        imports: {
          read: async ({ path: file, name, size }) =>
            name.endsWith('.m4a') ? readAudio(size, 60) : readTranscript(await readFile(file, 'utf8'), name),
          listen: async () => ({ kind: 'journal', opening: 'A few thoughts.', guess: 'Sounds like a journal.' }),
          run: async function* (job, file) {
            if (!job.fields) throw new Error('Missing import fields')
            runs.push(startArgs({ ...job, source: job.readback.source }, job.fields, file))
            yield { type: 'line', text: 'Filed the meeting.', level: 'log', command: 'meeting:new', depth: 1 }
            return { ok: true, file: DAY_DOC }
          },
        },
      },
      async ({ page, origin, errors }) => {
        const meeting = {
          title: 'Atlas sync',
          start: '09:30',
          end: '10:00',
          allDay: false,
          who: ['Jane Doe'],
          joinUrl: null,
          state: 'past',
          record: null,
        }
        await page.route('**/day/*/schedule', (route) =>
          route.fulfill({
            json: {
              read: true,
              errors: [],
              meetings: [
                meeting,
                {
                  ...meeting,
                  title: 'Widget review',
                  start: '11:00',
                  end: '11:30',
                  record: { path: DAY_DOC, title: 'Widget review', inline: true },
                },
              ],
            },
          }),
        )
        await page.setViewportSize({ width: 1400, height: 900 })
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.waitForSelector(ROW)
        const recap = { name: 'recap.vtt', type: 'text/vtt', text: TRANSCRIPT }

        await dispatchFileDrag(page, '.sky-day .sky-col', recap)
        await page.waitForSelector('.sky-drop')
        await dispatchFileDrag(page, `${ROW} .sky-dr-label`, recap)
        await page.waitForSelector(`${ROW}[data-dragging]`)
        await page.waitForSelector('.sky-drop', { state: 'detached' })
        const highlight = await page.locator(ROW).evaluate((row) => {
          const css = getComputedStyle(row)
          return { background: css.backgroundColor, outline: css.outlineStyle, width: css.outlineWidth }
        })
        const hint = await page.textContent(`${ROW} .sky-dr-mark`)
        // Leaving the row for the page clears just the row's highlight.
        await page.locator(`${ROW} .sky-dr-label`).evaluate((target) => {
          const transfer = new DataTransfer()
          transfer.items.add(new File([''], 'recap.vtt', { type: 'text/vtt' }))
          target.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: transfer }))
        })
        await page.waitForSelector(`${ROW}[data-dragging]`, { state: 'detached' })
        assert({
          given: 'a file dragged from the page into an unrecorded meeting, then out again',
          should: 'highlight only that row in blue, show a drop hint, and clear on leaving',
          actual: [
            highlight.background !== 'rgba(0, 0, 0, 0)',
            highlight.outline,
            highlight.width,
            hint,
            await page.locator(ROW).count(),
            await page.locator(`${SECTION}[data-dragging]`).count(),
          ],
          expected: [true, 'solid', '2px', 'drop to import', 1, 0],
        })

        for (const file of [recap, { name: 'memo.m4a', type: 'audio/mp4', text: 'mock recording' }]) {
          await dispatchFileDrop(page, `${ROW} .sky-dr-who`, file)
          await page.waitForSelector('.sky-confirm-title:has-text("New meeting")')
          if (file.name.endsWith('.m4a'))
            await page.waitForSelector('.sky-confirm-guess:has-text("Sounds like a journal")')
          assert({
            given: `${file.name} dropped on the Atlas slot, including an audio guess of journal`,
            should: 'open the shared meeting import dialog with the selected day, time and meeting',
            actual: [
              await page.inputValue('input[aria-label="When"]'),
              await page.textContent('.sky-confirm-title'),
              await page.textContent('.sky-when-cal'),
              await page.locator('.sky-drop').count(),
              await page.locator(`${ROW}[data-dragging]`).count(),
            ],
            expected: [
              '2026-08-05 09:30',
              file.name.endsWith('.m4a') ? 'New meeting from a voice memo' : 'New meeting from a transcript',
              'For “Atlas sync” on your calendar',
              0,
              0,
            ],
          })
          await page.getByRole('button', { name: 'Start', exact: true }).click()
          await page.waitForSelector('.sky-filed-doc')
          await page.waitForSelector('.sky-confirm', { state: 'detached' })
          // A duplicate bubbling drop would have left a second queued dialog.
          assert({
            given: 'the drop has started',
            should: 'leave no duplicate import waiting',
            actual: await page.locator('.sky-confirm').count(),
            expected: 0,
          })
          await page.goto(`${origin}/${DAY.ymd}`)
          await page.waitForSelector(ROW)
        }
        assert({
          given: 'both imports started from the slot',
          should: 'run meeting:new through the correct source door with the chosen time stated',
          actual: runs.map((run) => ({
            command: run.command,
            file: path.basename(String(run.args.fromZoomVtt ?? run.args.fromVoiceMemo)),
            when: String(run.args.when),
            clock: run.args.clock,
            rawArgs: run.rawArgs,
          })),
          expected: ['recap.vtt', 'memo.m4a'].map((file) => ({
            command: 'meeting:new',
            file,
            when: '2026-08-05 09:30',
            clock: undefined,
            rawArgs: { _: [], when: '2026-08-05 09:30' },
          })),
        })

        await dispatchFileDrop(page, '.sky-day .sky-col', recap)
        await page.waitForSelector('.sky-confirm-title:has-text("New meeting")')
        assert({
          given: 'a subsequent ordinary page drop',
          should: 'keep the normal time proposal without a selected slot',
          actual: [
            await page.inputValue('input[aria-label="When"]'),
            await page.locator('.sky-when-cal').count(),
            errors,
          ],
          expected: ['2026-08-05 10:00', 0, []],
        })
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      },
    )
  },
)

test(
  { name: 'day — the Meetings section imports unscheduled meetings on the viewed day', timeout: 60000 },
  async (t) => {
    const runs: StartArgs[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '---\ncreated: 2026-08-05 07:00\n---\n\n# Day\n',
        tempPrefix: 'day-meetings-section-drop-',
        file: DAY_DOC,
        day: true,
        imports: {
          read: async ({ path: file, name, size }) =>
            name.endsWith('.m4a') ? readAudio(size, 60) : readTranscript(await readFile(file, 'utf8'), name),
          suggestWhen: () => '2026-08-09 15:45',
          listen: async () => ({ kind: 'journal', opening: 'A few thoughts.', guess: 'Sounds like a journal.' }),
          run: async function* (job, file) {
            if (!job.fields) throw new Error('Missing import fields')
            runs.push(startArgs({ ...job, source: job.readback.source }, job.fields, file))
            yield { type: 'line', text: 'Filed the meeting.', level: 'log', command: 'meeting:new', depth: 1 }
            return { ok: true, file: DAY_DOC }
          },
        },
      },
      async ({ page, origin, errors }) => {
        const scheduled = {
          title: 'Atlas sync',
          start: '09:30',
          end: '10:00',
          allDay: false,
          who: ['Jane Doe'],
          joinUrl: null,
          state: 'past',
          record: null,
        }
        let calendar = { read: true, meetings: [scheduled], errors: [] as string[] }
        await page.route('**/day/*/schedule', (route) => route.fulfill({ json: calendar }))
        await page.setViewportSize({ width: 1400, height: 900 })
        const transcript = { name: 'unscheduled.vtt', type: 'text/vtt', text: TRANSCRIPT }
        const audio = { name: 'unscheduled.m4a', type: 'audio/mp4', text: 'mock recording' }
        const cases = [
          { calendar, target: `${SECTION} .sky-rail-sec-h`, file: transcript, time: '15:45' },
          {
            calendar: { read: true, meetings: [], errors: [] },
            target: SECTION,
            file: audio,
            time: '16:20',
          },
          {
            calendar: { read: false, meetings: [], errors: ['Calendar unavailable'] },
            target: `${SECTION} .sky-rail-sec-h`,
            file: transcript,
            time: '15:45',
          },
        ]
        for (const [index, example] of cases.entries()) {
          calendar = example.calendar
          await page.goto(`${origin}/${DAY.ymd}`)
          await page.waitForSelector(`${SECTION} .sky-dr-item, ${SECTION} .sky-rail-empty`)
          await dispatchFileDrag(page, example.target, example.file)
          await page.waitForSelector(`${SECTION}[data-dragging]`)
          const blue = await page.locator(SECTION).evaluate((section) => {
            const css = getComputedStyle(section)
            return css.backgroundColor !== 'rgba(0, 0, 0, 0)' && css.boxShadow !== 'none'
          })
          assert({
            given: 'a file held over the Meetings heading or its open drop area',
            should: 'highlight the whole section without the page overlay or a row highlight',
            actual: [
              blue,
              await page.locator('.sky-drop').count(),
              await page.locator(`${ROW}[data-dragging]`).count(),
            ],
            expected: [true, 0, 0],
          })
          if (index === 0) {
            // Move into the nested row and back, with the matching enter/leave events.
            const move = async (from: string, to: string) =>
              page.evaluate(
                ({ from, to }) => {
                  const transfer = new DataTransfer()
                  transfer.items.add(new File([''], 'unscheduled.vtt', { type: 'text/vtt' }))
                  for (const [selector, type] of [
                    [to, 'dragenter'],
                    [from, 'dragleave'],
                    [to, 'dragover'],
                  ]) {
                    document.querySelector(selector)!.dispatchEvent(
                      new DragEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        dataTransfer: transfer,
                      }),
                    )
                  }
                },
                { from, to },
              )
            await move(example.target, `${ROW} .sky-dr-label`)
            await page.waitForSelector(`${ROW}[data-dragging]`)
            await page.waitForSelector(`${SECTION}[data-dragging]`, { state: 'detached' })
            await move(`${ROW} .sky-dr-label`, example.target)
            await page.waitForSelector(`${SECTION}[data-dragging]`)
            await page.waitForSelector(`${ROW}[data-dragging]`, { state: 'detached' })
          }
          await dispatchFileDrop(page, example.target, example.file)
          await page.waitForSelector('.sky-confirm-title:has-text("New meeting")')
          if (example.file === audio) await page.waitForSelector('.sky-confirm-guess:has-text("Sounds like a journal")')
          assert({
            given: 'an unscheduled file whose proposed date differs from the viewed day',
            should: 'select Meeting, use the viewed day with the suggested clock time, and clear the highlight',
            actual: [
              await page.inputValue('input[aria-label="When"]'),
              await page.textContent('.sky-pill[data-on="true"]'),
              await page.locator('.sky-when-cal').count(),
              await page.locator(`${SECTION}[data-dragging]`).count(),
            ],
            expected: ['2026-08-05 15:45', 'Meeting', 0, 0],
          })
          if (example.time !== '15:45')
            await page.locator('input[aria-label="When"]').fill(`${DAY.ymd} ${example.time}`)
          await page.getByRole('button', { name: 'Start', exact: true }).click()
          await page.waitForSelector('.sky-filed-doc')
          await page.waitForSelector('.sky-confirm', { state: 'detached' })
        }
        assert({
          given: 'drops with a populated, empty, or unavailable calendar, including an adjusted time',
          should: 'start each meeting exactly once at its confirmed time on the viewed day',
          actual: [
            runs.map((run) => ({ command: run.command, when: String(run.args.when), rawArgs: run.rawArgs })),
            errors,
          ],
          expected: [
            cases.map(({ time }) => ({
              command: 'meeting:new',
              when: `${DAY.ymd} ${time}`,
              rawArgs: { _: [], when: `${DAY.ymd} ${time}` },
            })),
            [],
          ],
        })
      },
    )
  },
)
