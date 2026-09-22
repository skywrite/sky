import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { dayAIChatsDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const CHAT = path.posix.join('time', dayAIChatsDir(DAY), '09-00_Atlas-planning.md')
const CONTEXT = 'The launch checklist has no owner. Agree who will sign off before the demo.'
const CONTENT = `---
started: 08:00
ended:
tz: America/Chicago
---

# A sample day

## Professional Todos

- Confirm the Atlas launch owner with Jane

  ${CONTEXT}

  [Source chat](/chat/source/atlas-planning)
- Book the demo room
`

test(
  { name: 'day task context is readable, survives refreshes, and opens its saved source chat', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: CONTENT,
        tempPrefix: 'sky-day-context-',
        file: path.posix.join('time', dayFile(DAY)),
        day: true,
        now: new ZonedDateTime('2026-01-27T10:00:00', 'America/Chicago'),
        files: {
          [CHAT]:
            '---\ncreated: 2026-01-27\nsummary: Atlas planning\n---\n\n# Atlas planning\n\n## User\n\nConfirm the launch owner.\n\n## Sky\n\nReview the sign-off with Jane.\n',
        },
        chat: (base) => ({
          timeDir: path.join(base, 'time'),
          createSession: async () => {
            throw new Error('This test reads saved chats only.')
          },
          sourceLinks: { get: async () => CHAT, set: async () => {} },
          openSaved: async () => ({
            resume: await loadResumeSession(path.join(base, CHAT), { baseDir: base }),
            startTime: new PlainDateTime('2026-01-27T09:00:00'),
          }),
        }),
      },
      async ({ page, origin, file, errors }) => {
        await page.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
        let refreshed = false
        await page.route('**/chat', (route) =>
          route.fulfill({
            json: {
              threads: refreshed
                ? [
                    {
                      id: 'another-chat',
                      title: 'Another conversation',
                      day: DAY.ymd,
                      state: 'done',
                      busy: false,
                      turns: 2,
                      when: '10:00',
                      saved: null,
                      parent: null,
                      inherited: 0,
                    },
                  ]
                : [],
            },
          }),
        )
        await page.goto(`${origin}/${DAY.ymd}`)
        const notes = page.locator('.sky-item-notes')
        await notes.getByText(CONTEXT, { exact: true }).waitFor()
        const link = notes.getByRole('link', { name: 'Source chat' })
        assert({
          given: 'a todo created with conversation context',
          should: 'show the notes below its title and keep the chat route clickable',
          actual: await link.getAttribute('href'),
          expected: '/chat/source/atlas-planning',
        })
        const selected = await notes.evaluate((node) => {
          const range = document.createRange()
          range.selectNodeContents(node)
          const selection = window.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
          return selection.toString()
        })
        const refresh = page.waitForResponse((response) => response.url().endsWith(`/day/${DAY.ymd}`))
        refreshed = true
        await refresh
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        assert({
          given: 'background chat polling refreshes the day while context is selected across paragraphs',
          should: 'preserve the browser selection',
          actual: await page.evaluate(() => window.getSelection()?.toString()),
          expected: selected,
        })
        await writeFile(file, CONTENT.replace(CONTEXT, 'Jane will review the checklist with the release team.'))
        refreshed = false
        await notes.getByText('Jane will review the checklist with the release team.', { exact: true }).waitFor()
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 })
          assert({
            given: `task context on a ${width}px window`,
            should: 'wrap within the row without horizontal overflow',
            actual: await notes.evaluate(
              (node) => node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().right <= window.innerWidth,
            ),
            expected: true,
          })
        }
        await link.click()
        await page.waitForURL(`${origin}/explorer/${CHAT}`)
        await page.getByText('Review the sign-off with Jane.', { exact: true }).waitFor()
        assert({
          given: 'the source chat opened from a todo',
          should: 'raise no browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)
