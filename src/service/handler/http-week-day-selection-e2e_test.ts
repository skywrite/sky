import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { exists } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test({ name: 'week days open without files and first edits prepare unstarted days', timeout: 45000 }, async (t) => {
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: '# Example\n',
      tempPrefix: 'week-day-selection-',
      day: true,
      now: new ZonedDateTime(new PlainDateTime('08:00', '2031-03-17'), 'America/Chicago'),
    },
    async ({ page, origin, file, errors }) => {
      const root = path.dirname(path.dirname(file))
      const tuesday = new PlainDate('2031-03-18')
      const tuesdayFile = path.join(root, 'time', dayFile(tuesday))
      await page.goto(`${origin}/week`)
      await page.getByRole('button', { name: /Tuesday Mar 18/ }).click()
      await page.getByRole('button', { name: 'Add a reminder', exact: true }).waitFor()
      const untouched = !(await exists(tuesdayFile))
      await page.getByRole('button', { name: 'Add a reminder', exact: true }).click()
      const text = page.getByRole('textbox', { name: 'Item text', exact: true })
      await text.fill('Water the plants')
      await text.press('Enter')
      await page.locator('.sky-ptext').filter({ hasText: 'Water the plants' }).waitFor()
      const tuesdayDay = DayDocument.fromMarkdown(await readFile(tuesdayFile, 'utf8'))

      const nextMonday = new PlainDate('2031-03-24')
      const nextMondayFile = path.join(root, 'time', dayFile(nextMonday))
      await page.goto(`${origin}/week/2031-W13`)
      await page.getByRole('button', { name: /Monday Mar 24/ }).click()
      await page.getByRole('button', { name: 'Add a to-do', exact: true }).waitFor()
      const futureUntouched = !(await exists(nextMondayFile))
      await page.getByRole('button', { name: 'Add a to-do', exact: true }).click()
      await text.fill('Review the Atlas outline')
      await text.press('Enter')
      await page.locator('.sky-ptext').filter({ hasText: 'Review the Atlas outline' }).waitFor()
      const mondayDay = DayDocument.fromMarkdown(await readFile(nextMondayFile, 'utf8'))

      assert({
        given: 'an upcoming day in this week and a day in an uncreated future week',
        should: 'navigate without writing, then save each item to an unstarted day file',
        actual: {
          untouched,
          futureUntouched,
          tuesdayStarted: tuesdayDay.started,
          tuesdayReminders: tuesdayDay.lists.find((list) => list.title === 'Reminders')?.items,
          mondayStarted: mondayDay.started,
          mondayTodos: mondayDay.lists.find((list) => list.title === 'Professional Todos')?.items,
          errors,
        },
        expected: {
          untouched: true,
          futureUntouched: true,
          tuesdayStarted: undefined,
          tuesdayReminders: ['Water the plants'],
          mondayStarted: undefined,
          mondayTodos: ['Review the Atlas outline'],
          errors: [],
        },
      })
    },
  )
})
