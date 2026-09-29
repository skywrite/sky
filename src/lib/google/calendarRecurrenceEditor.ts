import type { Page } from 'playwright'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { calendarRepeatSummaryMatches, type RecurringTiming } from './calendarRecurrence.ts'

/** Set civil repeat fields in the unsaved editor; template RRULEs can shift their day or end date. */
export async function prepareCalendarRecurrence(page: Page, timing: RecurringTiming): Promise<void> {
  const control = page.getByRole('combobox', { name: 'Recurrence', exact: true })
  const repeat = timing.recurrence
  if (repeat) {
    await control.click()
    await page.getByRole('option', { name: 'Custom...', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Custom recurrence', exact: true })
    const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[repeat.frequency]
    await dialog.getByRole('combobox', { name: 'Frequency', exact: true }).click()
    await dialog.getByRole('option', { name: new RegExp(`^${unit}s?$`) }).click()
    const interval = dialog.getByRole('spinbutton', { name: /to repeat$/ })
    await interval.fill(String(repeat.interval))
    await interval.press('Tab')

    if (repeat.frequency === 'weekly') {
      const weekday = new PlainDate(timing.date).dayLong
      // Explicitly select exactly one day, including when Google's default uses the account's other timezone.
      const selected = dialog.getByRole('button', { name: weekday, exact: true })
      if ((await selected.getAttribute('aria-pressed')) !== 'true') await selected.click()
      for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
        const button = dialog.getByRole('button', { name: day, exact: true })
        if (day !== weekday && (await button.getAttribute('aria-pressed')) === 'true') await button.click()
      }
    } else if (repeat.frequency === 'monthly') {
      await dialog.getByRole('combobox', { name: 'Repeat:', exact: true }).click()
      await dialog.getByRole('option', { name: `Monthly on day ${Number(timing.date.slice(8))}`, exact: true }).click()
    }

    const ends = repeat.ends
    if (ends.type === 'never') {
      await dialog.getByRole('radio', { name: 'Recurrence never ends.', exact: true }).check()
    } else if (ends.type === 'on') {
      await dialog.getByRole('radio', { name: /^Recurrence ends on / }).check()
      const date = dialog.getByRole('textbox', { name: 'Date on which the recurrence ends', exact: true })
      await date.fill(ends.date)
      await date.press('Tab')
    } else {
      await dialog.getByRole('radio', { name: /^Recurrence ends after / }).check()
      const count = dialog.getByRole('spinbutton', { name: 'Occurrence count', exact: true })
      await count.fill(String(ends.count))
      await count.press('Tab')
    }
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  }
  if (!calendarRepeatSummaryMatches(await control.innerText(), timing))
    throw new Error('Calendar did not keep the requested repeat schedule. Nothing was saved.')
}
