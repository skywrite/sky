// The clarifying questions after the write-up check, on the import's own page: the words above
// each question; Skip answers one with nothing, Answer sends the phrase, Skip the rest ends them.
// Left out of `dev:test:unit` (a real browser); run it with
// `bun test service/handler/http-import-questions-e2e_test.ts`.

import * as path from 'node:path'
import type { Page } from 'playwright'
import type { RunEvent } from '#commands/lib/core/runCommand.ts'
import type { PromptRequest } from '#commands/lib/prompt/Prompter.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-08-05')
const DAY_DOC = path.posix.join('time', dayFile(DAY))
const CHAT = 'Jane Doe 10:32 AM\nAre we still on for Thursday?\n\nAlex Chen 10:34 AM\nYes, 7 at the usual place.\n'
const QUESTIONS = [
  { quote: 'I want to move the whole launch', question: 'Decided, or still a thought?' },
  { quote: 'the whole launch', question: 'The public launch, or just the beta?' },
  { quote: 'maybe go back to the Friday demos', question: 'Was that about the demos for the whole team?' },
]

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
  { name: 'import — a few questions after the check: skip one, answer one, skip the rest', timeout: 60000 },
  async (t) => {
    const answers: unknown[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '---\ncreated: 2026-08-05 07:00\n---\n\n# Day\n',
        tempPrefix: 'import-questions-',
        file: DAY_DOC,
        day: true,
        imports: {
          run: async function* (_job, _files, signal) {
            let n = 0
            // A question the way the runner asks it: an event carrying its reply, answered null on cancel.
            const question = (request: PromptRequest): { event: RunEvent; answered: Promise<unknown> } => {
              let reply!: (answer: unknown) => void
              const answered = new Promise<unknown>((resolve) => {
                reply = (answer) => resolve(answer)
              })
              signal.addEventListener('abort', () => reply(null), { once: true })
              return { event: { type: 'prompt', id: `p${++n}`, request, reply }, answered }
            }
            yield {
              type: 'plan',
              steps: [
                { id: 'writeup', label: 'Writing it up' },
                { id: 'questions', label: 'A few questions' },
                { id: 'file', label: 'Filing' },
              ],
              command: 'meeting:new',
              depth: 1,
            }
            yield {
              type: 'stage',
              id: 'questions',
              label: 'A few questions',
              detail: null,
              command: 'meeting:new',
              depth: 1,
            }
            for (const q of QUESTIONS) {
              const ask = question({
                kind: 'text',
                prompt: {
                  message: q.question,
                  hint: [`“${q.quote}”`, 'Enter skips this one · Esc ends the questions'],
                  placeholder: 'A phrase is enough',
                },
              })
              yield ask.event
              const answer = await ask.answered
              answers.push(answer)
              if (answer === null) break
            }
            yield { type: 'stage', id: 'file', label: 'Filing', detail: null, command: 'meeting:new', depth: 1 }
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
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.waitForSelector('.sky-day button[aria-label="Add a file"]:not([disabled])')
        await dispatchTextDrag(page, '.sky-day .sky-col', { 'text/plain': CHAT })
        await page.waitForSelector('.sky-confirm-title')
        await page.click('.sky-choice .sky-pill:has-text("Meeting")')
        await page.getByRole('button', { name: 'Start', exact: true }).click()

        // The first question: the words above it, and Skip while the field is empty.
        await page.waitForSelector('.sky-say-quote')
        const first = {
          head: await page.locator('.sky-block-head:has-text("A few questions")').count(),
          quote: await page.textContent('.sky-say-quote'),
          question: await page.textContent('.sky-say'),
          buttons: await page.locator('.sky-exchange-input button').allTextContents(),
        }
        await page.getByRole('button', { name: 'Skip', exact: true }).click()

        // The second: a phrase typed turns Skip into Answer.
        await page.waitForSelector(`.sky-say:has-text("${QUESTIONS[1].question}")`)
        await page.fill('.sky-exchange-input textarea', 'Just the beta')
        const typed = await page.locator('.sky-exchange-input button').allTextContents()
        await page.getByRole('button', { name: 'Answer', exact: true }).click()

        // The third: Skip the rest ends them, and the run goes on to file.
        await page.waitForSelector(`.sky-say:has-text("${QUESTIONS[2].question}")`)
        const said = await page.locator('.sky-say-user').allTextContents()
        await page.getByRole('button', { name: 'Skip the rest', exact: true }).click()
        await page.waitForSelector('.sky-filed-doc')

        assert({
          given: 'three questions: one skipped, one answered, then Skip the rest',
          should: 'show each with its words, send nothing, the phrase, then null, and let the run file',
          actual: { first, typed, said, answers, errors },
          expected: {
            first: {
              head: 1,
              quote: '“I want to move the whole launch”',
              question: 'Decided, or still a thought?',
              buttons: ['Skip', 'Skip the rest'],
            },
            typed: ['Answer', 'Skip the rest'],
            said: ['Skipped', 'Just the beta'],
            answers: ['', 'Just the beta', null],
            errors: [],
          },
        })
      },
    )
  },
)
