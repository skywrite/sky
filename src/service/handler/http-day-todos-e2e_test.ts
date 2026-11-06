import { mkdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { dayFile } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2031-03-17')
const CONTENT = `---
started: 08:00
tz: UTC
---

# Sample day

## Most Important

- Decide the launch scope for Atlas

## Professional Commitments

- 11:30 > Review Atlas launch plan with Jane Doe
- 09:00 > Atlas planning

## Personal Commitments

- 17:30 > Evening walk

## Professional Todos

- Draft the Atlas project brief
  Keep these notes.
- ~~Clear the inbox~~

## Personal Todos

- Book annual checkup
- Send the garden plan
- Review supplies
- Replace the porch light

## Reminders

- Pause before saying yes.
`

test(
  {
    name: 'grouped To-dos keep five priorities overall, align right-hand times, and preserve editing and overrides',
    timeout: 90000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: CONTENT,
        file: 'time/' + dayFile(DAY),
        tempPrefix: 'day-todos-',
        day: true,
        todoPriority: {
          context: async () => [{ path: 'goals/Atlas.md', text: 'The project brief is needed first.', excerpt: false }],
          rank: async ({ tasks }) =>
            tasks.map(
              (item) =>
                ({
                  'Draft the Atlas project brief': 4,
                  'Book annual checkup': 3.5,
                  'Review Atlas launch plan with Jane Doe': 3,
                  'Atlas planning': 2.5,
                  'Evening walk': 2,
                })[item.text] ?? 0.5,
            ),
        },
      },
      async ({ page, origin, file, errors }) => {
        await page.addInitScript(() => localStorage.setItem('sky-rail', 'closed'))
        for (const width of [1500, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 })
          await page.goto(`${origin}/${DAY.ymd}?view=record`)
          const open = page.locator('.sky-todos-open')
          await open.locator('.sky-ptext').first().waitFor()
          await page.waitForFunction(
            () => document.querySelector('.sky-todos-open .sky-ptext')?.textContent === 'Draft the Atlas project brief',
          )
          const layout = await open.locator('.sky-todo-row').evaluateAll((rows) =>
            rows.map((row) => {
              const text = row.querySelector('.sky-ptext')!
              const title = text.getBoundingClientRect()
              const time = row.querySelector('.sky-todo-time')?.getBoundingClientRect()
              const bounds = row.querySelector('.sky-irow-front')!.getBoundingClientRect()
              const range = document.createRange()
              range.selectNodeContents(text)
              const first = range.getClientRects()[0]
              return {
                left: Math.round(title.left),
                right: !time || (time.left > title.left && time.right <= bounds.right + 1),
                firstLine: !time || Math.abs(time.top + time.height / 2 - (first.top + first.height / 2)) < 7,
              }
            }),
          )
          assert({
            given: `timed and untimed tasks at ${width}px, including a long title`,
            should: 'share a title edge, keep times at the right beside the first line, and retain the other sections',
            actual: {
              titles: await open.locator('.sky-ptext').allTextContents(),
              aligned: new Set(layout.map((row) => row.left)).size,
              right: layout.every((row) => row.right),
              firstLine: layout.every((row) => row.firstLine),
              commitmentsHeading: await page
                .locator('.sky-bhead')
                .filter({ hasText: /^Commitments/ })
                .count(),
              priority: await page.locator('.sky-day-priority .sky-ptext').innerText(),
              collapsed: await page.locator('.sky-todos-completed-list').count(),
              hidden: await page.getByRole('button', { name: 'Show 3 more', exact: true }).count(),
              groups: await open
                .locator('.sky-todos-group')
                .evaluateAll((groups) =>
                  groups.map((group) => [
                    group.querySelector('.sky-igroup')?.textContent,
                    group.querySelectorAll('.sky-todo-row').length,
                  ]),
                ),
              tags: await open.locator('.sky-pchip').count(),
              overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              title: await page.title(),
            },
            expected: {
              titles: [
                'Draft the Atlas project brief',
                'Review Atlas launch plan with Jane Doe',
                'Atlas planning',
                'Book annual checkup',
                'Evening walk',
              ],
              aligned: 1,
              right: true,
              firstLine: true,
              commitmentsHeading: 0,
              priority: 'Decide the launch scope for Atlas',
              collapsed: 0,
              hidden: 1,
              groups: [
                ['Professional', 3],
                ['Personal', 2],
              ],
              tags: 0,
              overflow: false,
              title: 'sky · Monday, March 17, 2031 · Day record',
            },
          })
          const screenshots = env.get('SKY_TODO_SCREENSHOTS')
          if (screenshots) {
            await mkdir(screenshots, { recursive: true })
            await page.screenshot({ path: path.join(screenshots, `todos-${width}.png`), fullPage: true })
          }
        }
        const planning = page.locator('.sky-todo-row').filter({ hasText: 'Atlas planning' })
        await planning.getByRole('button', { name: /^Edit time:/ }).click()
        const dialog = page.getByRole('dialog', { name: 'Item details' })
        assert({
          given: 'a timed item opened from its time on a phone',
          should: 'identify it as a To-do',
          actual: await dialog.getByRole('combobox', { name: 'Type', exact: true }).inputValue(),
          expected: 'To-do',
        })
        await dialog.getByRole('button', { name: 'Remove time', exact: true }).click()
        await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        await planning.waitFor()
        assert({
          given: 'a to-do with its time removed',
          should: 'save to the existing untimed heading and remove its time affordance',
          actual: [
            /## Professional Todos[\s\S]*- Atlas planning/.test(await readFile(file, 'utf8')),
            await planning.locator('.sky-todo-time').count(),
          ],
          expected: [true, 0],
        })
        await page.locator('.sky-item-edit-undo').getByRole('button', { name: 'Undo', exact: true }).click()
        await planning.getByRole('button', { name: /^Edit time:/ }).waitFor()
        await page.reload()
        await planning.getByRole('button', { name: /^Edit time:/ }).waitFor()
        assert({
          given: 'Undo followed by a direct reload',
          should: 'retain the source file exactly and finish without browser errors',
          actual: [await readFile(file, 'utf8'), errors],
          expected: [CONTENT, []],
        })
        await page.getByRole('button', { name: 'Show 3 more', exact: true }).click()
        assert({
          given: 'the rest of the list expanded on a small phone',
          should: 'make every lower-priority task available',
          actual: await page.locator('.sky-todos-open .sky-ptext').count(),
          expected: 8,
        })
        await page.getByRole('button', { name: 'Show top 5', exact: true }).click()
        await page.getByRole('button', { name: 'Organize', exact: true }).click()
        const personal = page.locator('.sky-todos-open .sky-todos-group').filter({
          has: page.getByRole('heading', { name: 'Personal', exact: true }),
        })
        let priorityWrites = 0
        page.on('request', (request) => {
          if (request.url().endsWith('/item/organize/priority')) priorityWrites++
        })
        const keyboardSave = page.waitForResponse((response) => response.url().endsWith('/item/organize/priority'))
        await page.getByRole('button', { name: 'Reorder Evening walk', exact: true }).press('ArrowUp')
        await (await keyboardSave).finished()
        await personal
          .locator('.sky-ptext')
          .first()
          .filter({ hasText: /^Evening walk$/ })
          .waitFor()
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Reorder Evening walk')
        await page.keyboard.press('ArrowUp')
        await page.waitForTimeout(200)
        assert({
          given: 'a personal task moved above its category neighbor, then up again at the category boundary',
          should: 'reorder within the category and stop at its heading',
          actual: {
            personal: await personal.locator('.sky-ptext').allTextContents(),
            headings: await page.locator('.sky-todos-open .sky-igroup').allTextContents(),
            priorityWrites,
          },
          expected: {
            personal: [
              'Evening walk',
              'Book annual checkup',
              'Send the garden plan',
              'Review supplies',
              'Replace the porch light',
            ],
            headings: ['Professional', 'Personal'],
            priorityWrites: 1,
          },
        })
        await page.locator('.sky-organize-toast').getByRole('button', { name: 'Undo', exact: true }).click()
        await personal
          .locator('.sky-ptext')
          .first()
          .filter({ hasText: /^Book annual checkup$/ })
          .waitFor()
        const promoted = page.locator('.sky-todos-open .sky-todo-row').filter({ hasText: 'Review supplies' })
        await promoted.getByRole('button', { name: 'Move to top: Review supplies', exact: true }).click()
        await personal
          .locator('.sky-ptext')
          .first()
          .filter({ hasText: /^Review supplies$/ })
          .waitFor()
        assert({
          given: 'manual priority controls at 320px',
          should: 'fit the viewport while all tasks are available',
          actual: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          expected: false,
        })
        await page.locator('.sky-organize-bar').getByRole('button', { name: 'Done', exact: true }).click()
        await page.reload()
        await promoted.waitFor()
        assert({
          given: 'a lower-priority task promoted above Jev’s suggestions, followed by reload',
          should: 'preserve the override above both categories and return to five visible tasks',
          actual: [
            await page.locator('.sky-todos-open .sky-igroup').allTextContents(),
            await page.locator('.sky-todos-open .sky-ptext').allTextContents(),
          ],
          expected: [
            ['Professional', 'Personal'],
            [
              'Draft the Atlas project brief',
              'Review Atlas launch plan with Jane Doe',
              'Atlas planning',
              'Review supplies',
              'Book annual checkup',
            ],
          ],
        })
        await promoted.getByRole('button', { name: 'Mark done', exact: true }).click()
        await promoted.waitFor({ state: 'detached' })
        assert({
          given: 'completion of a visible task',
          should: 'fill its place with the next priority while keeping Most Important separate',
          actual: [
            await page.locator('.sky-todos-open .sky-ptext').count(),
            await page.locator('.sky-todos-open .sky-ptext').first().textContent(),
            await page.locator('.sky-day-priority .sky-ptext').textContent(),
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            errors,
          ],
          expected: [5, 'Draft the Atlas project brief', 'Decide the launch scope for Atlas', false, []],
        })
        await page.getByRole('button', { name: 'Completed · 2', exact: true }).click()
        assert({
          given: 'completed tasks from both categories',
          should: 'identify their categories with headings too',
          actual: {
            headings: await page.locator('.sky-todos-completed-list .sky-igroup').allTextContents(),
            tags: await page.locator('.sky-todos-completed-list .sky-pchip').count(),
          },
          expected: { headings: ['Professional', 'Personal'], tags: 0 },
        })
        await page.getByRole('button', { name: 'Organize', exact: true }).click()
        await page.getByRole('button', { name: "Use Sky's order", exact: true }).click()
        await page.getByRole('button', { name: "Use Sky's order", exact: true }).waitFor({ state: 'detached' })
        await page.locator('.sky-organize-toast').getByRole('button', { name: 'Undo', exact: true }).click()
        await page.getByRole('button', { name: "Use Sky's order", exact: true }).waitFor()
        assert({
          given: 'restoring Sky’s order then undoing that choice',
          should: 'restore the person’s override without changing the task',
          actual: (await readFile(file, 'utf8')).includes('manual: true'),
          expected: true,
        })
      },
    )
  },
)

test({ name: 'To-dos say Sky is prioritizing only while it asks the model', timeout: 60000 }, async (t) => {
  let asked = 0
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: CONTENT,
      file: 'time/' + dayFile(DAY),
      tempPrefix: 'day-todos-status-',
      day: true,
      todoPriority: {
        context: async () => [],
        // Stands in for a model call slow enough to be worth a status line
        rank: async ({ tasks }) => {
          asked++
          await delay(1500)
          return tasks.map(() => 1)
        },
      },
    },
    async ({ page, origin, errors }) => {
      // Counts every moment the line is on screen, even one too brief for a wait to catch
      await page.addInitScript(() => {
        const seen = { count: 0 }
        ;(window as unknown as { prioritizing: typeof seen }).prioritizing = seen
        new MutationObserver(() => {
          const lines = [...document.querySelectorAll('.sky-todo-priority-status')]
          if (lines.some((line) => line.textContent?.includes('prioritizing'))) seen.count++
        }).observe(document, { subtree: true, childList: true, characterData: true })
      })
      const status = page.getByText('Sky is prioritizing…', { exact: true })
      await page.goto(`${origin}/${DAY.ymd}?view=record`)
      await status.waitFor()
      await status.waitFor({ state: 'detached' })
      const askedFirst = asked
      let priorityChecks = 0
      page.on('request', (request) => {
        if (request.url().endsWith('/todo-priority')) priorityChecks++
      })
      await page.reload()
      await page.locator('.sky-todos-open .sky-ptext').first().waitFor()
      await page.waitForTimeout(300)
      assert({
        given: 'a first ranking that asks the model, then a reload that reuses it',
        should: 'show the status line only while the model is asked',
        actual: {
          askedFirst,
          askedAgain: asked - askedFirst,
          priorityChecks,
          shownAfterReload: await page.evaluate(
            () => (window as unknown as { prioritizing: { count: number } }).prioritizing.count,
          ),
          errors,
        },
        expected: { askedFirst: 1, askedAgain: 0, priorityChecks: 0, shownAfterReload: 0, errors: [] },
      })
    },
  )
})
