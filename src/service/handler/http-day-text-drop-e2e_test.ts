// Text dragged onto the day: a conversation selected in another app, let go on the page, opens
// the import dialog, which asks what it is — a message first — and Start runs the message door
// on the text. A drag that began on the page, a link, or a drop into a field is not an import.
// Left out of `dev:test:unit` (a real browser); run it with
// `bun test service/handler/http-day-text-drop-e2e_test.ts`.

import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { type StartArgs, startArgs } from './import/startArgs.ts'

const DAY = new PlainDate('2026-08-05')
const DAY_DOC = path.posix.join('time', dayFile(DAY))
const CHAT = 'Jane Doe 10:32 AM\nAre we still on for Thursday?\n\nAlex Chen 10:34 AM\nYes, 7 at the usual place.\n'

/**
 * Text held over an element the way a selection dragged from another app arrives —
 * `text/plain` among the transfer's types, and `text/uri-list` too for a link — and, with
 * `drop`, let go there.
 */
async function dispatchTextDrag(
  page: Page,
  selector: string,
  data: Record<string, string>,
  steps: string[] = ['dragenter', 'dragover', 'drop'],
) {
  await page.evaluate(
    ({ selector, data, steps }) => {
      const target = document.querySelector(selector)
      if (!target) throw new Error(`No element at ${selector}`)
      const transfer = new DataTransfer()
      for (const [type, value] of Object.entries(data)) transfer.setData(type, value)
      for (const type of steps) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
      }
    },
    { selector, data, steps },
  )
}

test({ name: 'day — text dragged onto the day is asked about, and files as a message', timeout: 60000 }, async (t) => {
  const runs: { start: StartArgs; text: string }[] = []
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: '---\ncreated: 2026-08-05 07:00\n---\n\n# Day\n',
      tempPrefix: 'day-text-drop-',
      file: DAY_DOC,
      day: true,
      imports: {
        run: async function* (job, files) {
          if (!job.fields) throw new Error('Missing import fields')
          runs.push({
            start: startArgs({ ...job, source: job.readback.source }, job.fields, files),
            text: await readFile(files[0], 'utf8'),
          })
          yield { type: 'line', text: 'Filed one message.', level: 'log', command: 'message:new', depth: 1 }
          return { ok: true, file: DAY_DOC }
        },
      },
    },
    async ({ page, origin, errors }) => {
      await page.setViewportSize({ width: 1400, height: 900 })
      // The rail's calendar reads the real keychain; the day has no meetings here.
      await page.route('**/day/*/schedule', (route) =>
        route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
      )
      // An upload takes a moment on a real service: the dialog opens before the read-back lands.
      await page.route('**/import', async (route) => {
        if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 400))
        await route.continue()
      })
      await page.goto(`${origin}/${DAY.ymd}`)
      await page.waitForSelector('.sky-day button[aria-label="Add a file"]:not([disabled])')
      const jobs = async () => (await (await page.request.get(`${origin}/import`)).json()).imports as unknown[]
      const dialogOpen = () => page.evaluate(() => document.querySelector('.sky-confirm') !== null)
      // A dialog that should not come up is looked for after the time one would take to.
      const dialogAfterAWhile = async () => {
        await page.waitForTimeout(500)
        return dialogOpen()
      }

      // Held over the page: the overlay says what a text becomes.
      await dispatchTextDrag(page, '.sky-day .sky-col', { 'text/plain': CHAT }, ['dragenter', 'dragover'])
      const overlay = await page.textContent('.sky-drop')

      // Let go: the dialog asks what it is, a message first.
      await dispatchTextDrag(page, '.sky-day .sky-col', { 'text/plain': CHAT }, ['drop'])
      await page.waitForSelector('.sky-confirm-title:has-text("New message from dropped text")')
      const read = {
        file: await page.textContent('.sky-confirm-file'),
        summary: await page.textContent('.sky-confirm-read'),
        opening: await page.textContent('.sky-confirm-opening'),
        kinds: await page.locator('.sky-choice .sky-pill').allTextContents(),
        chosen: await page.textContent('.sky-choice .sky-pill[data-on="true"]'),
        whenNote: (await page.textContent('.sky-when-note'))?.split(' · ')[0],
        next: await page.textContent('.sky-confirm-next'),
      }
      await page.click('.sky-choice .sky-pill:has-text("Meeting")')
      const asMeeting = await page.textContent('.sky-confirm-title')
      await page.click('.sky-choice .sky-pill:has-text("Message")')
      await page.getByRole('button', { name: 'Start', exact: true }).click()
      await page.waitForSelector('.sky-confirm', { state: 'detached' })
      await page.waitForSelector('.sky-filed-doc')

      assert({
        given: 'a conversation dragged from another app and let go on the day',
        should: 'say what it becomes, then ask what it is with a message chosen, and say how a message is made',
        actual: { overlay, read, asMeeting },
        expected: {
          overlay: 'Drop the text on the daySky asks what it is — a conversation or a meeting — then files it.',
          read: {
            file: 'Dropped text · 1 KB',
            summary: 'Text · 4 lines',
            opening:
              'Starts: “Jane Doe 10:32 AM Are we still on for Thursday? Alex Chen 10:34 AM Yes, 7 at the usual place.”',
            kinds: ['Message', 'Meeting'],
            chosen: 'Message',
            whenNote: 'when you dropped it',
            next: 'Sky reads the conversation out of the text, checks what it read with you, and files it as a message under the day.',
          },
          asMeeting: 'New meeting from dropped text',
        },
      })
      assert({
        given: 'Start with Message chosen',
        should: 'run the message door on the text exactly as it was dragged',
        actual: runs.map(({ start, text }) => ({
          command: start.command,
          file: path.basename(String(start.args.fromText)),
          text,
        })),
        expected: [{ command: 'message:new', file: 'selection.txt', text: CHAT }],
      })

      // What is not an import: a drag that began on the page, a link, a drop into a field.
      await page.goto(`${origin}/${DAY.ymd}`)
      await page.waitForSelector('.sky-day button[aria-label="Add a file"]:not([disabled])')
      const before = (await jobs()).length
      await page.evaluate(() => {
        document.querySelector('.sky-day .sky-col')!.dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
      })
      await dispatchTextDrag(page, '.sky-day .sky-col', { 'text/plain': 'Ship the Atlas deck' })
      const fromPage = await dialogAfterAWhile()
      await page.evaluate(() => {
        document.querySelector('.sky-day .sky-col')!.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
      })
      await dispatchTextDrag(page, '.sky-day .sky-col', {
        'text/uri-list': 'https://example.com/atlas',
        'text/plain': 'https://example.com/atlas',
      })
      const link = await dialogAfterAWhile()
      await page.evaluate(() => {
        const field = document.createElement('textarea')
        field.className = 'test-field'
        document.querySelector('.sky-day .sky-col')!.append(field)
      })
      await dispatchTextDrag(page, '.sky-day .sky-col .test-field', { 'text/plain': CHAT })
      const intoField = await dialogAfterAWhile()
      assert({
        given: 'a drag begun on the page, a dragged link, and text let go in a field',
        should: 'leave each alone: no dialog, no import',
        actual: [fromPage, link, intoField, (await jobs()).length - before, errors],
        expected: [false, false, false, 0, []],
      })
    },
  )
})
