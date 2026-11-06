import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { dayDir, dayFile, weekDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2031-03-17')
const PROJECT = 'projects/Atlas/brief.md'
const PROJECT_LINK = path.relative('time/' + dayDir(DAY), PROJECT)
const CONTENT = `---
started: 08:00
tz: UTC
---

## Most Important

- [Decide the Atlas scope](${PROJECT_LINK})

## Professional Todos

- Draft the Atlas brief
- Send the agenda

## Reminders

- Pause before replying
- Keep the long-term goal in mind
`

for (const width of [1500, 390]) {
  test({ name: `completing tasks and reminders keeps the visible order at ${width}px`, timeout: 60000 }, async (t) => {
    const todos = [
      'Draft Atlas brief',
      'Book annual checkup',
      'Send agenda',
      'Plan the garden',
      'Review launch notes',
      'Review supplies',
    ]
    const reminders = [
      'Pause before replying',
      'Keep the goal in mind',
      'Ask what success means',
      'Leave space between meetings',
      'Review assumptions',
      'Make room for reflection',
      'Leave room for a walk',
    ]
    const suggested = [5, 1, 4, 3, 2, 0, 6].map((index) => reminders[index])
    const calls = { todos: 0, reminders: 0 }
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: `## Most Important\n\n- Decide the Atlas scope\n\n## Professional Todos\n\n${[0, 2, 4].map((index) => '- ' + todos[index]).join('\n')}\n\n## Personal Todos\n\n${[1, 3, 5].map((index) => '- ' + todos[index]).join('\n')}\n\n## Reminders\n\n${reminders.map((text) => '- ' + text).join('\n')}\n`,
        file: 'time/' + dayFile(DAY),
        tempPrefix: 'day-priority-stability-',
        day: true,
        todoPriority: {
          context: async () => [],
          rank: async ({ tasks }) => {
            calls.todos++
            return tasks.map((item, index) => (calls.todos === 1 ? 4 - todos.indexOf(item.text) / 2 : index / 2))
          },
        },
        reminderPriority: {
          context: async () => [],
          rank: async ({ tasks }) => {
            calls.reminders++
            return tasks.map((item, index) =>
              calls.reminders === 1 ? 4 - suggested.indexOf(item.text) / 2 : index / 2,
            )
          },
        },
      },
      async ({ page, origin, errors }) => {
        await page.setViewportSize({ width, height: 1000 })
        const requests = { todos: 0, reminders: 0 }
        page.on('request', (request) => {
          if (request.url().endsWith('/todo-priority')) requests.todos++
          if (request.url().endsWith('/reminder-priority')) requests.reminders++
        })
        const initial = Promise.all(
          ['todo', 'reminder'].map((group) =>
            page.waitForResponse((response) => response.url().endsWith(`/${group}-priority`)),
          ),
        )
        await page.goto(`${origin}/${DAY.ymd}?view=record`)
        await initial
        const openTodos = page.locator('.sky-todos-open')
        const openReminders = page.locator('.sky-reminders-open')
        await openReminders
          .locator('.sky-ptext')
          .first()
          .filter({ hasText: /^Make room for reflection$/ })
          .waitFor()
        const task = openTodos.locator('.sky-todo-row').filter({ hasText: 'Draft Atlas brief' })
        await task.getByRole('button', { name: 'Mark done', exact: true }).click()
        await task.waitFor({ state: 'detached' })
        // Let the old debounce fire: a transient correct order before a fresh model response is not enough.
        await page.waitForTimeout(900)
        const expectedTodos = [todos[2], todos[4], todos[1], todos[3], todos[5]]
        assert({
          given: 'the highest-ranked Professional task is completed while a Personal task is ranked next',
          should: 'keep the category headings and survivors steady, fill the fifth place, and keep reminders steady',
          actual: [
            await openTodos.locator('.sky-igroup').allTextContents(),
            await openTodos.locator('.sky-ptext').allTextContents(),
            await openReminders.locator('.sky-ptext').allTextContents(),
            calls,
            requests,
          ],
          expected: [
            ['Professional', 'Personal'],
            expectedTodos,
            suggested.slice(0, 5),
            { todos: 1, reminders: 1 },
            { todos: 1, reminders: 1 },
          ],
        })
        for (let count = 1; count <= 2; count++) {
          const first = openReminders.locator('.sky-prow').filter({ hasText: suggested[count - 1] })
          await first.getByRole('button', { name: 'Mark done', exact: true }).click()
          await first.waitFor({ state: 'detached' })
          await page.waitForTimeout(900)
          assert({
            given: `${count} reminders cleared from the top`,
            should: 'move the second reminder to first and keep every survivor in sequence without a new ranking',
            actual: [await openReminders.locator('.sky-ptext').allTextContents(), calls, requests],
            expected: [suggested.slice(count, count + 5), { todos: 1, reminders: 1 }, { todos: 1, reminders: 1 }],
          })
        }
        await page
          .locator('.sky-undo')
          .filter({ hasText: 'Reminder cleared' })
          .getByRole('button', { name: 'Undo', exact: true })
          .click()
        await openReminders
          .locator('.sky-ptext')
          .first()
          .filter({ hasText: /^Keep the goal in mind$/ })
          .waitFor()
        await page.reload()
        await openReminders.locator('.sky-ptext').first().waitFor()
        await page.waitForTimeout(900)
        assert({
          given: 'Undo followed by reload',
          should: 'restore the previous position and preserve both orders without browser errors',
          actual: [
            await openTodos.locator('.sky-ptext').allTextContents(),
            await openReminders.locator('.sky-ptext').allTextContents(),
            calls,
            requests,
            errors,
            await page.title(),
          ],
          expected: [
            expectedTodos,
            suggested.slice(1, 6),
            { todos: 1, reminders: 1 },
            { todos: 1, reminders: 1 },
            [],
            'sky · Monday, March 17, 2031 · Day record',
          ],
        })
      },
    )
  })
}

test(
  { name: 'priority refreshes follow selected context changes and coalesce edits without polling', timeout: 60000 },
  async (t) => {
    const calls = { todos: 0, reminders: 0 }
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: CONTENT,
        file: 'time/' + dayFile(DAY),
        tempPrefix: 'day-priority-events-',
        day: true,
        files: {
          'goals/Focus.md': '# Focus\n\nKeep the review focused.\n',
          'me/about.md': '# About\n\nMake time for important work.\n',
          [PROJECT]: '# Brief\n\nPrepare the Atlas scope.\n',
        },
        todoPriority: {
          rank: async ({ tasks }) => {
            calls.todos++
            return tasks.map((_, index) => index)
          },
        },
        reminderPriority: {
          rank: async ({ tasks }) => {
            calls.reminders++
            return tasks.map((_, index) => index)
          },
        },
      },
      async ({ page, origin, file, userDataDir, errors }) => {
        const requests = { todos: 0, reminders: 0 }
        page.on('request', (request) => {
          if (request.url().endsWith('/todo-priority')) requests.todos++
          if (request.url().endsWith('/reminder-priority')) requests.reminders++
        })
        const rankings = () =>
          Promise.all(
            ['todo', 'reminder'].map((kind) =>
              page.waitForResponse((response) => response.url().endsWith(`/${kind}-priority`)),
            ),
          )
        const dayRead = () => page.waitForResponse((response) => response.url() === `${origin}/day/${DAY.ymd}`)
        await page.clock.install({ time: '2031-03-17T08:00:00Z' })
        const initial = rankings()
        await page.goto(`${origin}/${DAY.ymd}?view=record`)
        await initial
        await page.waitForFunction(
          () =>
            document.querySelector('.sky-todos-open .sky-ptext')?.textContent === 'Send the agenda' &&
            document.querySelector('.sky-reminders-open .sky-ptext')?.textContent === 'Keep the long-term goal in mind',
        )
        await page.clock.fastForward(16 * 60_000)
        await page.waitForTimeout(350)
        const resumed = dayRead()
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await resumed
        await page.getByRole('button', { name: 'Organize', exact: true }).click()
        await page.locator('.sky-organize-bar').getByRole('button', { name: 'Done', exact: true }).click()
        await page.reload()
        await page.locator('.sky-reminders-open .sky-ptext').first().waitFor()
        await page.waitForTimeout(350)
        assert({
          given: 'sixteen idle minutes, tab activation, Organize without edits, and a reload',
          should: 'keep both rankings without another priority check or model call',
          actual: [requests, calls],
          expected: [
            { todos: 1, reminders: 1 },
            { todos: 1, reminders: 1 },
          ],
        })

        const root = path.dirname(userDataDir)
        const external = dayRead()
        await writeFile(path.join(root, 'projects/Atlas/unrelated.md'), '# Unrelated notes\n')
        await external
        await page.waitForTimeout(350)
        assert({
          given: 'an unlinked file changes outside the selected context',
          should: 'leave both rankings alone',
          actual: [requests, calls],
          expected: [
            { todos: 1, reminders: 1 },
            { todos: 1, reminders: 1 },
          ],
        })

        const goalsRanked = rankings()
        for (let i = 0; i < 8; i++) {
          await writeFile(path.join(root, 'goals/Focus.md'), `# Focus\n\nGoal update ${i}.\n`)
          await delay(40)
        }
        await goalsRanked
        await page.waitForTimeout(350)
        assert({
          given: 'a burst of eight goal edits with no day-file changes',
          should: 'request and calculate one new ranking for each list',
          actual: [requests, calls],
          expected: [
            { todos: 2, reminders: 2 },
            { todos: 2, reminders: 2 },
          ],
        })
        let expected = 2
        const journal = `time/${dayDir(DAY.addDays(-1))}/journal/Reflection.md`
        for (const [source, content] of [
          ['me/about.md', '# About\n\nMake room for reflection.\n'],
          [`time/${weekDir(Week.of(DAY).startInYear)}/week.md`, '# Week\n\nReview the launch scope.\n'],
          ['time/commitments.md', '# Commitments\n\n- Send the agreed review.\n'],
          [`time/${dayDir(DAY)}/most-important/Focus.md`, '# Focus\n\nSettle the main decision.\n'],
          [PROJECT, '# Brief\n\nThe review deadline moved.\n'],
          [`time/${dayDir(DAY.addDays(-1))}/summary.md`, '# Summary\n\nLeave time between decisions.\n'],
          [journal, '# Reflection\n\nPause before replying.\n'],
        ]) {
          const ranked = rankings()
          const target = path.join(root, source)
          await mkdir(path.dirname(target), { recursive: true })
          await writeFile(target, content)
          await ranked
          await page.waitForTimeout(350)
          expected++
          assert({
            given: `a change to priority context in ${source}`,
            should: 'refresh both lists once, including context filed under an earlier day',
            actual: [requests, calls],
            expected: [
              { todos: expected, reminders: expected },
              { todos: expected, reminders: expected },
            ],
          })
        }
        const deletedContext = rankings()
        await rm(path.join(root, journal))
        await deletedContext
        await page.waitForTimeout(350)
        expected++
        assert({
          given: 'a recent journal used for priority is removed',
          should: 'refresh both lists with the remaining context',
          actual: [requests, calls],
          expected: [
            { todos: expected, reminders: expected },
            { todos: expected, reminders: expected },
          ],
        })

        const withNotes = CONTENT.replace(
          '- Draft the Atlas brief',
          '- Draft the Atlas brief\n  Review the new outline.',
        )
        const notesRanked = rankings()
        await writeFile(file, withNotes)
        await notesRanked
        await page.waitForTimeout(350)
        expected++
        assert({
          given: 'only an item’s notes change in day.md',
          should: 'refresh both lists once, even though their titles and order are unchanged',
          actual: [requests, calls],
          expected: [
            { todos: expected, reminders: expected },
            { todos: expected, reminders: expected },
          ],
        })

        await page.getByRole('button', { name: 'Organize', exact: true }).click()
        const whileOrganizing = withNotes.replace('Decide the Atlas scope', 'Review the Atlas scope')
        await writeFile(file, whileOrganizing)
        await page.getByText('Review the Atlas scope', { exact: true }).waitFor()
        assert({
          given: 'Most Important changes on disk during Organize',
          should: 'defer both priority requests until organizing ends',
          actual: requests,
          expected: { todos: expected, reminders: expected },
        })
        const afterOrganizing = rankings()
        await page.locator('.sky-organize-bar').getByRole('button', { name: 'Done', exact: true }).click()
        await afterOrganizing
        await page.waitForTimeout(350)
        expected++

        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
          document.dispatchEvent(new Event('visibilitychange'))
        })
        const hiddenRead = dayRead()
        await writeFile(path.join(root, 'goals/Focus.md'), '# Focus\n\nFinish the review thoughtfully.\n')
        await hiddenRead
        await page.waitForTimeout(350)
        assert({
          given: 'a relevant context edit arrives while the tab is hidden',
          should: 'wait for the tab to become visible without polling',
          actual: requests,
          expected: { todos: expected, reminders: expected },
        })
        const afterVisible = rankings()
        await page.evaluate(() => {
          Reflect.deleteProperty(document, 'visibilityState')
          document.dispatchEvent(new Event('visibilitychange'))
        })
        await afterVisible
        await page.waitForTimeout(350)
        expected++
        assert({
          given: 'the tab becomes visible after a queued context change',
          should: 'refresh each list once without browser errors',
          actual: [requests, calls, errors],
          expected: [{ todos: expected, reminders: expected }, { todos: expected, reminders: expected }, []],
        })
      },
    )
  },
)
