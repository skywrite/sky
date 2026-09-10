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
    { name: `checked day items stay in their lists in completion and time order at ${width}px`, timeout: 45000 },
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
          await page.goto(`${origin}/${DAY.ymd}`)
          const card = (name: string) =>
            page
              .locator('.sky-col > .sky-block')
              .filter({ has: page.locator('.sky-block-head').filter({ hasText: new RegExp(`^${name}`) }) })
          const todos = card('To-dos')
          const commitments = card('Commitments')
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
            await row(name).locator('.sky-check:not(:disabled)').waitFor()
          }
          const labels = async (name: string) =>
            card(name)
              .locator('.sky-ptext')
              .evaluateAll((nodes) => nodes.map((node) => node.childNodes[0]?.textContent ?? ''))
          await row('Older completed task').getByRole('button', { name: 'Mark not done', exact: true }).waitFor()
          assert({
            given: 'existing checked tasks loaded from Markdown',
            should: 'show checked items above open ones within their category and commitments by time',
            actual: {
              todos: await labels('To-dos'),
              commitments: await commitments.locator('.sky-when').allTextContents(),
            },
            expected: {
              todos: [
                'Older completed task',
                'First open task',
                'Read Atlas brief',
                'Final open task',
                'Personal completed task',
                'Personal open task',
              ],
              commitments: ['9:00', '17:00', '7:00', '12:00', '25:30'],
            },
          })
          await toggle('Read Atlas brief', true)
          assert({
            given: 'a newly completed linked to-do',
            should: 'stay visible after the existing completed task, retain its link, and avoid duplicating Done today',
            actual: {
              todos: await labels('To-dos'),
              link: await row('Read Atlas brief').getByRole('link').getAttribute('href'),
              doneToday: await card('Done today').locator('.sky-ptext').allTextContents(),
              progress: await page.locator('.sky-day-progress').innerText(),
              saved: DayDocument.fromMarkdown(await readFile(file, 'utf8')).lists.find(
                (list) => list.title === 'Professional Todos',
              )?.items,
            },
            expected: {
              todos: [
                'Older completed task',
                'Read Atlas brief',
                'First open task',
                'Final open task',
                'Personal completed task',
                'Personal open task',
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
          await row('Read Atlas brief').getByRole('button', { name: 'Mark not done', exact: true }).waitFor()
          await toggle('Read Atlas brief', false)
          await toggle('Late open commitment', true)
          assert({
            given: 'a late commitment checked before an early open one',
            should: 'put all checked commitments first in time order',
            actual: await commitments.locator('.sky-when').allTextContents(),
            expected: ['9:00', '17:00', '25:30', '7:00', '12:00'],
          })
          await toggle('Early open commitment', true)
          await toggle('Later completed commitment', false)
          assert({
            given: 'an early completion followed by reopening a later completed commitment',
            should: 'keep both the completed and open groups sorted by time',
            actual: await commitments.locator('.sky-when').allTextContents(),
            expected: ['7:00', '9:00', '25:30', '12:00', '17:00'],
          })
          const reminder = row('Leave space for a walk')
          await reminder.getByRole('button', { name: 'Mark done', exact: true }).click()
          await reminder.waitFor({ state: 'detached' })
          await page.getByRole('button', { name: 'Undo', exact: true }).click()
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
            expected: { checked: 6, rows: 6, reminder: true, overflow: false, errors: [] },
          })
        },
      )
    },
  )
}
