// An import waiting on the person: the sidebar shows it on every page but its own, Review opens it, and the
// same text dropped again opens that import instead of starting a second one.
// Left out of `dev:test:unit` (a real browser); run it with
// `bun test service/handler/http-import-waiting-e2e_test.ts`. SKY_IMPORT_WAITING_SCREENSHOTS names a folder
// for captures.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { Page } from 'playwright'
import dayFile from '#shared/nbfs/dayFile.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-08-05')
const DAY_DOC = path.posix.join('time', dayFile(DAY))
const CHAT = 'Jane Doe 10:32 AM\nAre we still on for Thursday?\n\nAlex Chen 10:34 AM\nYes, 7 at the usual place.\n'

async function dispatchTextDrag(page: Page, selector: string, data: Record<string, string>) {
  await page.evaluate(
    ({ selector, data }) => {
      const target = document.querySelector(selector)
      if (!target) throw new Error(`No element at ${selector}`)
      const transfer = new DataTransfer()
      for (const [type, value] of Object.entries(data)) transfer.setData(type, value)
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
      }
    },
    { selector, data },
  )
}

test(
  {
    name: 'import — waiting on the person shows in the sidebar, and the same text dropped again opens it',
    timeout: 60000,
  },
  async (t) => {
    let runs = 0
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '---\ncreated: 2026-08-05 07:00\n---\n\n# Day\n',
        tempPrefix: 'import-waiting-',
        file: DAY_DOC,
        day: true,
        imports: {
          // Keyed by the staged bytes, the way the pipeline keys its run record.
          record: async ({ path: filePath, key }) => ({
            key:
              key ??
              createHash('sha256')
                .update(await readFile(filePath))
                .digest('hex'),
            resume: null,
          }),
          run: async function* (_job, _files, signal) {
            runs++
            let reply!: (answer: unknown) => void
            const answered = new Promise<unknown>((resolve) => {
              reply = resolve
            })
            signal.addEventListener('abort', () => reply(null), { once: true })
            yield {
              type: 'plan',
              steps: [
                { id: 'writeup', label: 'Checking the write-up' },
                { id: 'file', label: 'Filing' },
              ],
              command: 'meeting:new',
              depth: 1,
            }
            yield {
              type: 'stage',
              id: 'writeup',
              label: 'Checking the write-up',
              detail: null,
              command: 'meeting:new',
              depth: 1,
            }
            yield {
              type: 'prompt',
              id: 'p1',
              request: { kind: 'text', prompt: { message: 'Any corrections? (Enter to accept, or type changes)' } },
              reply,
            }
            if ((await answered) === null) return { ok: false, message: 'cancelled' }
            return { ok: true, file: DAY_DOC }
          },
        },
      },
      async ({ page, origin, errors }) => {
        const screenshots = env.get('SKY_IMPORT_WAITING_SCREENSHOTS')
        const capture = async (name: string) => {
          if (screenshots)
            await page.screenshot({ path: path.join(screenshots, `${name}.png`), animations: 'disabled' })
        }
        await page.setViewportSize({ width: 1400, height: 900 })
        // The rail's calendar reads the real keychain; the day has no meetings here.
        await page.route('**/day/*/schedule', (route) =>
          route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
        )
        const dropOnDay = async () => {
          await page.goto(`${origin}/${DAY.ymd}`)
          await page.waitForSelector('.sky-day button[aria-label="Add a file"]:not([disabled])')
          await dispatchTextDrag(page, '.sky-day .sky-col', { 'text/plain': CHAT })
        }
        const card = page.locator('.sky-side .sky-restart', { hasText: 'Needs you' })

        // Started, it asks the write-up check on its own page.
        await dropOnDay()
        await page.waitForSelector('.sky-confirm-title')
        await page.click('.sky-choice .sky-pill:has-text("Meeting")')
        await page.getByRole('button', { name: 'Start', exact: true }).click()
        await page.waitForSelector('.sky-exchange-input textarea')
        const id = new URL(page.url()).pathname.split('/').at(-1)

        // On a day that is not today, where the rail lists no meeting imports, the sidebar still says it waits.
        await page.goto(`${origin}/${DAY.ymd}`)
        await card.waitFor()
        const sidebar = await card.locator('[role="status"]').innerText()
        await capture('sidebar-waiting')

        // Review opens it, and on its own page the question is right there: the sidebar leaves it out.
        await page.getByRole('button', { name: 'Review Text 10:00', exact: true }).click()
        await page.waitForURL((url) => url.pathname === `/import/${id}`)
        await page.waitForSelector('.sky-exchange-input textarea')
        const onItsPage = await card.count()

        // The same text dropped again opens the waiting import, and says why.
        await dropOnDay()
        await page.waitForURL((url) => url.pathname === `/import/${id}` && url.searchParams.has('dropped'))
        const notice = await page.locator('.sky-import [role="status"].sky-lead').innerText()
        await capture('dropped-again')
        const listed = ((await (await fetch(`${origin}/import`)).json()) as { imports: { id: string }[] }).imports

        await fetch(`${origin}/import/${id}/cancel`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        assert({
          given: 'a text started as a meeting, waiting on its write-up check, then dropped again',
          should: 'show it in the sidebar off its own page, and open it rather than start a second run',
          actual: { onItsPage, sidebar, notice, listed: listed.map((job) => job.id), runs, errors },
          expected: {
            onItsPage: 0,
            sidebar: 'Text 10:00\nNeeds you · Any corrections?',
            notice:
              'You dropped this text again. It was already importing, so Sky opened this import instead of starting a second one.',
            listed: [id],
            runs: 1,
            errors: [],
          },
        })
      },
    )
  },
)
