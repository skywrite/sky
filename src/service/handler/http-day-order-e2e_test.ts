import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const FILE = path.posix.join('time', dayFile(DAY))
const MARKDOWN = `---
started: 08:00
ended:
tz: America/Chicago
---

# 2026-01-27

## Professional Todos

- First open task
- ~~Older completed task~~
- Read [Atlas brief](../../../../projects/Atlas/brief.md)
- Final open task

## Personal Todos

- Personal open task
- ~~Personal completed task~~

## Professional Commitments

- 07:00 > Early open commitment
- 17:00 > ~~Later completed commitment~~
- 09:00 > ~~Earlier completed commitment~~
- 25:30 > Late open commitment
- 12:00 > Midday open commitment

## Professional Complete

- 08:30 > Filed a sample report

## Reminders

- Leave space for a walk
`

for (const width of [1500, 390]) {
  test(
    { name: `checked day items retain their source lists in the combined To-dos view at ${width}px`, timeout: 45000 },
    async (t) => {
      await runWysiwygE2e(
        t,
        {
          initialMarkdown: MARKDOWN,
          tempPrefix: 'day-order-',
          file: FILE,
          day: true,
          files: { 'projects/Atlas/brief.md': '# Atlas brief\n\nA synthetic project brief.\n' },
        },
        async ({ page, origin, file, errors }) => {
          await page.setViewportSize({ width, height: 1000 })
          // Finish the fixture's initial ranking before completion starts preserving that order.
          const ranked = page.waitForResponse((response) => response.url().endsWith(`/day/${DAY.ymd}/todo-priority`))
          await page.goto(`${origin}/${DAY.ymd}`)
          await (await ranked).finished()
          const card = (name: string) =>
            page
              .locator('.sky-col > .sky-block')
              .filter({ has: page.locator('.sky-block-head').filter({ hasText: new RegExp(`^${name}`) }) })
          const todos = card('To-dos')
          const sections = {
            open: todos.locator('.sky-todos-open'),
            completed: todos.locator('.sky-todos-completed-list'),
          }
          const row = (name: string) =>
            page.locator('.sky-irow').filter({ has: page.locator('.sky-ptext').filter({ hasText: name }) })
          const toggle = async (name: string, done: boolean) => {
            const response = page.waitForResponse(
              (response) => response.url().endsWith(`/day/${DAY.ymd}/item`) && response.request().method() === 'POST',
            )
            await row(name)
              .getByRole('button', { name: done ? 'Mark done' : 'Mark not done', exact: true })
              .click()
            assert({
              given: `a task ${done ? 'checked' : 'reopened'} in its original list`,
              should: 'save successfully',
              actual: (await response).status(),
              expected: 200,
            })
            await sections[done ? 'completed' : 'open']
              .locator('.sky-irow')
              .filter({ has: page.getByText(name, { exact: true }) })
              .getByRole('button', { name: done ? 'Mark not done' : 'Mark done', exact: true })
              .and(page.locator(':enabled'))
              .waitFor()
          }
          const labels = async (section: keyof typeof sections) =>
            sections[section].locator('.sky-todos-group').evaluateAll((groups) =>
              groups.map((group) => ({
                category: group.querySelector('[role="heading"]')?.textContent,
                items: [...group.querySelectorAll('.sky-ptext')].map((node) => node.childNodes[0]?.textContent ?? ''),
              })),
            )
          const timedItems = async (section: keyof typeof sections) =>
            sections[section]
              .locator('.sky-irow')
              .filter({ has: page.locator('.sky-when') })
              .evaluateAll((rows) =>
                rows.map((row) => [
                  row.querySelector('.sky-ptext')?.childNodes[0]?.textContent,
                  row.querySelector('.sky-when')?.textContent,
                ]),
              )
          await todos.getByRole('button', { name: /^Show \d+ more$/ }).click()
          await todos.getByRole('button', { name: /^Completed ·/ }).click()
          await row('Older completed task').getByRole('button', { name: 'Mark not done', exact: true }).waitFor()
          assert({
            given: 'existing checked tasks loaded from Markdown',
            should: 'keep priority order within each category, with checked items under Completed',
            actual: {
              open: await labels('open'),
              completed: await labels('completed'),
              times: { open: await timedItems('open'), completed: await timedItems('completed') },
            },
            expected: {
              open: [
                {
                  category: 'Professional',
                  items: [
                    'First open task',
                    'Read Atlas brief',
                    'Final open task',
                    'Early open commitment',
                    'Late open commitment',
                    'Midday open commitment',
                  ],
                },
                { category: 'Personal', items: ['Personal open task'] },
              ],
              completed: [
                {
                  category: 'Professional',
                  items: ['Older completed task', 'Later completed commitment', 'Earlier completed commitment'],
                },
                { category: 'Personal', items: ['Personal completed task'] },
              ],
              times: {
                open: [
                  ['Early open commitment', '7:00'],
                  ['Late open commitment', '25:30'],
                  ['Midday open commitment', '12:00'],
                ],
                completed: [
                  ['Later completed commitment', '17:00'],
                  ['Earlier completed commitment', '9:00'],
                ],
              },
            },
          })
          await toggle('Read Atlas brief', true)
          assert({
            given: 'a newly completed linked to-do',
            should: 'stay visible after the existing completed task, retain its link, and avoid duplicating Done today',
            actual: {
              open: await labels('open'),
              completed: await labels('completed'),
              link: await row('Read Atlas brief').getByRole('link').getAttribute('href'),
              doneToday: await card('Done today').locator('.sky-ptext').allTextContents(),
              progress: await page.locator('.sky-day-progress').innerText(),
              saved: DayDocument.fromMarkdown(await readFile(file, 'utf8')).lists.find(
                (list) => list.title === 'Professional Todos',
              )?.items,
            },
            expected: {
              open: [
                {
                  category: 'Professional',
                  items: [
                    'First open task',
                    'Final open task',
                    'Early open commitment',
                    'Late open commitment',
                    'Midday open commitment',
                  ],
                },
                { category: 'Personal', items: ['Personal open task'] },
              ],
              completed: [
                {
                  category: 'Professional',
                  items: [
                    'Older completed task',
                    'Read Atlas brief',
                    'Later completed commitment',
                    'Earlier completed commitment',
                  ],
                },
                { category: 'Personal', items: ['Personal completed task'] },
              ],
              link: '/explorer/projects/Atlas/brief.md',
              doneToday: ['Filed a sample report'],
              progress: '6 of 12 tasks complete',
              saved: [
                '~~Older completed task~~',
                '~~Read [Atlas brief](../../../../projects/Atlas/brief.md)~~',
                'First open task',
                'Final open task',
              ],
            },
          })
          await page.reload()
          await todos.getByRole('button', { name: /^Show \d+ more$/ }).click()
          await todos.getByRole('button', { name: /^Completed ·/ }).click()
          await row('Read Atlas brief').getByRole('button', { name: 'Mark not done', exact: true }).waitFor()
          await toggle('Read Atlas brief', false)
          await toggle('Late open commitment', true)
          assert({
            given: 'a late commitment checked before an early open one',
            should: 'keep open tasks first, with checked items under Completed',
            actual: { open: await timedItems('open'), completed: await timedItems('completed') },
            expected: {
              open: [
                ['Early open commitment', '7:00'],
                ['Midday open commitment', '12:00'],
              ],
              completed: [
                ['Earlier completed commitment', '9:00'],
                ['Later completed commitment', '17:00'],
                ['Late open commitment', '25:30'],
              ],
            },
          })
          await toggle('Early open commitment', true)
          await toggle('Later completed commitment', false)
          assert({
            given: 'an early completion followed by reopening a later completed commitment',
            should: 'keep the open priority order and retain each time on its task in the correct section',
            actual: { open: await timedItems('open'), completed: await timedItems('completed') },
            expected: {
              open: [
                ['Midday open commitment', '12:00'],
                ['Later completed commitment', '17:00'],
              ],
              completed: [
                ['Early open commitment', '7:00'],
                ['Earlier completed commitment', '9:00'],
                ['Late open commitment', '25:30'],
              ],
            },
          })
          const reminder = row('Leave space for a walk')
          await reminder.getByRole('button', { name: 'Mark done', exact: true }).click()
          await reminder.waitFor({ state: 'detached' })
          await page
            .locator('.sky-undo')
            .filter({ hasText: 'Reminder cleared — “Leave space for a walk”' })
            .getByRole('button', { name: 'Undo', exact: true })
            .click()
          await reminder.waitFor()
          for (const name of ['Read Atlas brief', 'First open task', 'Final open task', 'Personal open task'])
            await toggle(name, true)
          assert({
            given: 'all to-dos checked, plus a cleared and restored reminder',
            should: 'keep every checked task visible, preserve reminder behavior and fit the viewport',
            actual: {
              checked: await todos.getByRole('button', { name: 'Mark not done', exact: true }).count(),
              rows: await todos.locator('.sky-irow').count(),
              reminder: (await readFile(file, 'utf8')).includes('- Leave space for a walk'),
              overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              errors,
            },
            expected: { checked: 9, rows: 11, reminder: true, overflow: false, errors: [] },
          })
        },
      )
    },
  )
}
