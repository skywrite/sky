import { mkdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2031-03-17')
const REMINDERS = [
  'Leave room for a walk',
  'Keep the long-term goal in mind',
  'Ask what success looks like',
  'Leave space between meetings',
  'Review assumptions before deciding',
  'Pause before replying',
  'Make room for reflection',
]
const CONTENT = `---
started: 08:00
tz: UTC
---

## Most Important

- Decide the Atlas launch scope

## Professional Todos

- Draft the Atlas brief
- Send the agenda

## Reminders

${REMINDERS.map((text) => '- ' + text).join('\n')}
`
const SUGGESTED = [REMINDERS[5], REMINDERS[1], REMINDERS[4], REMINDERS[3], REMINDERS[2], REMINDERS[0], REMINDERS[6]]

for (const width of [1500, 390, 320]) {
  test({ name: `reminder priorities, top five and manual overrides work at ${width}px`, timeout: 60000 }, async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: CONTENT,
        file: 'time/' + dayFile(DAY),
        tempPrefix: 'day-reminder-priority-',
        day: true,
        reminderPriority: {
          context: async () => [
            { path: 'goals/Focus.md', text: 'Make careful decisions during the Atlas review.', excerpt: false },
          ],
          rank: async ({ tasks }) => tasks.map((item) => 4 - SUGGESTED.indexOf(item.text) / 2),
        },
      },
      async ({ page, origin, file, errors }) => {
        await page.addInitScript(() => localStorage.setItem('sky-rail', 'closed'))
        await page.setViewportSize({ width, height: 1100 })
        await page.goto(`${origin}/${DAY.ymd}?view=record`)
        const card = page.locator('.sky-col > .sky-block').filter({ has: page.locator('.sky-reminders-open') })
        const rows = card.locator('.sky-reminders-open .sky-ptext')
        await page.waitForFunction(
          () => document.querySelector('.sky-reminders-open .sky-ptext')?.textContent === 'Pause before replying',
        )
        await card.scrollIntoViewIfNeeded()
        assert({
          given: 'seven reminders with context-driven scores',
          should: 'show only their top five without changing To-dos or Most Important',
          actual: [
            await rows.allTextContents(),
            await card.getByRole('button', { name: 'Show 2 more', exact: true }).count(),
            await page.locator('.sky-todos-open .sky-ptext').allTextContents(),
            await page.locator('.sky-day-priority .sky-ptext').textContent(),
            await page.title(),
          ],
          expected: [
            SUGGESTED.slice(0, 5),
            1,
            ['Draft the Atlas brief', 'Send the agenda'],
            'Decide the Atlas launch scope',
            'sky · Monday, March 17, 2031 · Day record',
          ],
        })
        const screenshots = env.get('SKY_REMINDER_SCREENSHOTS')
        if (screenshots) {
          await mkdir(screenshots, { recursive: true })
          await page.screenshot({ path: path.join(screenshots, `reminders-${width}.png`), fullPage: true })
        }
        await card.getByRole('button', { name: 'Show 2 more', exact: true }).click()
        assert({ given: 'Show more', should: 'reveal every reminder', actual: await rows.count(), expected: 7 })
        await card.getByRole('button', { name: 'Show top 5', exact: true }).click()
        await page.getByRole('button', { name: 'Organize', exact: true }).click()
        await card.getByRole('button', { name: 'Move to top: Make room for reflection', exact: true }).click()
        await page.waitForFunction(
          () => document.querySelector('.sky-reminders-open .sky-ptext')?.textContent === 'Make room for reflection',
        )
        assert({
          given: 'organizing reminders and offering a reset to Sky’s order',
          should: 'fit the viewport',
          actual: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          expected: false,
        })
        await page.locator('.sky-organize-bar').getByRole('button', { name: 'Done', exact: true }).click()
        await page.reload()
        await page.waitForFunction(
          () => document.querySelector('.sky-reminders-open .sky-ptext')?.textContent === 'Make room for reflection',
        )
        assert({
          given: 'a lower-ranked reminder manually promoted then reloaded',
          should: 'keep that override and collapse the list to five again',
          actual: [await rows.first().textContent(), await rows.count()],
          expected: ['Make room for reflection', 5],
        })
        const promoted = card.locator('.sky-prow').filter({ hasText: 'Make room for reflection' })
        await promoted.getByRole('button', { name: 'Mark done', exact: true }).click()
        await promoted.waitFor({ state: 'detached' })
        assert({
          given: 'a reminder cleared from the top five',
          should: 'bring the next reminder into view and remove the cleared line from the day',
          actual: [await rows.allTextContents(), (await readFile(file, 'utf8')).includes('- Make room for reflection')],
          expected: [SUGGESTED.slice(0, 5), false],
        })
        await page
          .locator('.sky-undo')
          .filter({ hasText: 'Reminder cleared' })
          .getByRole('button', { name: 'Undo', exact: true })
          .click()
        await promoted.waitFor()
        assert({
          given: 'Undo after clearing a promoted reminder',
          should: 'restore its priority',
          actual: await rows.first().textContent(),
          expected: 'Make room for reflection',
        })
        await page.getByRole('button', { name: 'Organize', exact: true }).click()
        const grip = card.getByRole('button', { name: 'Reorder Make room for reflection', exact: true })
        await grip.focus()
        const save = page.waitForResponse((response) => response.url().endsWith('/item/organize/priority'))
        await page.keyboard.press('ArrowDown')
        assert({
          given: 'keyboard reordering of a reminder',
          should: 'save a manual priority move',
          actual: (await save).status(),
          expected: 200,
        })
        await page.waitForFunction(
          () =>
            document.querySelectorAll('.sky-reminders-open .sky-ptext')[1]?.textContent === 'Make room for reflection',
        )
        await card.getByRole('button', { name: "Use Sky's order", exact: true }).click()
        await card.getByRole('button', { name: "Use Sky's order", exact: true }).waitFor({ state: 'detached' })
        await page.waitForFunction(
          () =>
            document.querySelectorAll('.sky-reminders-open .sky-ptext')[6]?.textContent === 'Make room for reflection',
        )
        assert({
          given: 'returning reminders to Sky’s order',
          should: 'restore suggestions without changing other lists or producing browser errors',
          actual: [
            await rows.allTextContents(),
            await page.locator('.sky-todos-open .sky-ptext').allTextContents(),
            errors,
          ],
          expected: [SUGGESTED, ['Draft the Atlas brief', 'Send the agenda'], []],
        })
      },
    )
  })
}
