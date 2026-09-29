import type { Page } from 'playwright'

export function calendarGuestRow(page: Page, email: string) {
  return page
    .getByRole('tabpanel', { name: 'Guests', exact: true })
    .locator(`[role="treeitem"][data-email=${JSON.stringify(email)} i]`)
}

/** Autocomplete can still show the previous query when Enter is pressed. Select the exact email instead. */
export async function addCalendarGuest(page: Page, email: string): Promise<void> {
  const row = calendarGuestRow(page, email)
  if (await row.isVisible()) return
  const panel = page.getByRole('tabpanel', { name: 'Guests', exact: true })
  const input = panel.getByRole('combobox', { name: 'Guests', exact: true })
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Calendar renders the autocomplete menu outside the Guests panel.
  const choice = page.getByRole('option', { name: new RegExp(`(?:^|\\s|<)${escaped}(?:$|\\s|>)`, 'i') }).first()
  try {
    await input.fill(email)
    await choice.click()
  } catch {
    throw new Error(`Google Calendar could not select ${email} from its guest suggestions. Nothing was saved.`)
  }
  try {
    await row.waitFor({ state: 'visible' })
  } catch {
    throw new Error(`Google Calendar did not keep ${email} in the guest list. Nothing was saved.`)
  }
  await input.evaluate((element) => element.blur())
}

export async function calendarGuestEmails(page: Page): Promise<string[]> {
  return page
    .getByRole('tabpanel', { name: 'Guests', exact: true })
    .locator('[role="treeitem"][data-email]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-email')!.toLowerCase()))
}
