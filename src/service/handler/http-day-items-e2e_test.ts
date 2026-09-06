// Run with `bun test service/handler/http-day-items-e2e_test.ts` (a real browser).
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-01-27')
const REMINDER = 'Review the Atlas checklist'
const DAY_MARKDOWN = `---
date: 2026-01-27
---

# **2026-01-27 - Tue**

## Professional Todos

- ${REMINDER}

## Reminders

`

for (const { name, reminders, remaining } of [
  {
    name: 'between other reminders',
    reminders: `- Refill the bird feeder\n- ${REMINDER}\n- Water the plants\n`,
    remaining: '- Refill the bird feeder\n- Water the plants\n',
  },
  {
    name: 'as the only reminder',
    reminders: `- ${REMINDER}\n`,
    remaining: '-\n',
  },
]) {
  test({ name: `day — completing a reminder ${name} deletes it, and Undo restores it`, timeout: 30000 }, async (t) => {
    const original = DAY_MARKDOWN + reminders
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: original,
        tempPrefix: 'day-items-',
        file: path.posix.join('time', dayFile(DAY)),
        day: true,
      },
      async ({ page, origin, file, errors }) => {
        await page.goto(`${origin}/${DAY.ymd}`)
        const reminderRow = page.locator('.sky-prow[data-soft="true"]').filter({ hasText: REMINDER })
        await reminderRow.getByRole('button', { name: 'Mark done', exact: true }).click()
        await page.waitForSelector('.sky-undo-text:has-text("Reminder cleared")')
        await reminderRow.waitFor({ state: 'detached' })

        assert({
          given: `a reminder ${name} checked in the web UI, with an identical to-do`,
          should: 'remove the reminder line from the day file and preserve the to-do and everything around it',
          actual: await readFile(file, 'utf8'),
          expected: DAY_MARKDOWN + remaining,
        })
        assert({
          given: 'a completed reminder',
          should: 'leave no Done today entry',
          actual: await page.locator('.sky-block-head').filter({ hasText: 'Done today' }).count(),
          expected: 0,
        })

        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await reminderRow.waitFor({ state: 'visible' })
        assert({
          given: 'Undo after completing a reminder',
          should: 'restore the reminder at its original position and the exact original file',
          actual: await readFile(file, 'utf8'),
          expected: original,
        })

        const todoRow = page.locator('.sky-prow:not([data-soft])').filter({ hasText: REMINDER })
        await todoRow.getByRole('button', { name: 'Mark done', exact: true }).click()
        await page.waitForSelector('.sky-undo-text:has-text("Done")')
        assert({
          given: 'the identically named to-do checked after restoring the reminder',
          should: 'strike the to-do and keep the reminder untouched',
          actual: await readFile(file, 'utf8'),
          expected: original.replace(`- ${REMINDER}\n`, `- ~~${REMINDER}~~\n`),
        })
        assert({
          given: 'the reminder and to-do actions',
          should: 'raise no page errors',
          actual: errors,
          expected: [],
        })
      },
    )
  })
}
