import type { Page } from 'playwright'
import type { CalendarSchedulerHost, CreatedCalendarEvent } from '#lib/calendarScheduler/types.ts'
import type { CalendarEventFields, CalendarEventSnapshot } from '#lib/calendarScheduler/updateTypes.ts'
import { validateEventUpdate } from '#lib/calendarScheduler/updateValidation.ts'
import { meetingInterval } from '#lib/calendarScheduler/validation.ts'
import { calendarInstant, calendarLocal, instantNow } from '#universal/dates/nbdt/mod.ts'
import { withGoogleBrowser } from './browserSession.ts'
import { formDate, formTime, zoomMeetingUrl } from './createCalendarMeeting.ts'

const emails = (guests: { email: string }[]) => [...new Set(guests.map((guest) => guest.email.toLowerCase()))].sort()
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function conferenceHref(href: string): string {
  try {
    const url = new URL(href)
    return url.hostname === 'www.google.com' && url.pathname === '/url'
      ? (url.searchParams.get('q') ?? url.searchParams.get('url') ?? href)
      : href
  } catch {
    return href
  }
}

/** Adding guests can trigger Google's automatic Meet setting; retain the reviewed conference choice. */
async function preserveConference(page: Page, event: CalendarEventSnapshot): Promise<void> {
  if (event.conferenceUrl) {
    const controls = page.getByRole('link', { name: /join/i }).or(page.getByRole('button', { name: /join/i }))
    const links = await controls.evaluateAll((items) => items.map((item) => item.getAttribute('href') ?? ''))
    if (!links.some((href) => conferenceHref(href) === event.conferenceUrl))
      throw new Error('Calendar did not retain the existing conference link. Nothing was saved.')
  } else {
    const remove = page.getByRole('button', { name: /remove.*(conferenc|Google Meet|Zoom)/i })
    if (await remove.isVisible()) {
      await remove.click()
      await remove.waitFor({ state: 'hidden' })
    }
  }
}

export function savedCalendarUpdateMatches(
  saved: CalendarEventSnapshot,
  before: CalendarEventSnapshot,
  fields: CalendarEventFields,
): boolean {
  const interval = meetingInterval(fields)
  return (
    same(saved.ref, before.ref) &&
    saved.version !== before.version &&
    !saved.unsupported.length &&
    saved.iCalUid === before.iCalUid &&
    saved.recurring === before.recurring &&
    calendarInstant(saved.start) === interval.startMilliseconds &&
    calendarInstant(saved.end) === interval.endMilliseconds &&
    saved.fields.title === fields.title &&
    saved.fields.description === fields.description &&
    saved.fields.location === fields.location &&
    same(emails(saved.fields.guests), emails(fields.guests)) &&
    same([...saved.resourceEmails].sort(), [...before.resourceEmails].sort()) &&
    saved.conferenceUrl === before.conferenceUrl
  )
}

async function readTiming(page: Page) {
  const date = async (name: string) => formDate(await page.getByRole('textbox', { name, exact: true }).inputValue())
  const time = async (name: string) => formTime(await page.getByRole('combobox', { name, exact: true }).inputValue())
  return {
    date: await date('Start date'),
    time: await time('Start time'),
    endDate: await date('End date'),
    endTime: await time('End time'),
  }
}

async function verifyGuests(page: Page, event: CalendarEventSnapshot, fields: CalendarEventFields) {
  const actual = await page
    .getByRole('tabpanel', { name: 'Guests', exact: true })
    .locator('[role="treeitem"][data-email]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-email')!.toLowerCase()))
  const ignored = new Set([event.ref.account.toLowerCase(), event.ref.calendarId.toLowerCase()])
  const expected = [...emails(fields.guests), ...event.resourceEmails].filter((email) => !ignored.has(email))
  if (!same([...new Set(actual.filter((email) => !ignored.has(email)))].sort(), [...new Set(expected)].sort()))
    throw new Error('Calendar did not keep the reviewed guests and rooms. Nothing was saved.')
}

/** Open one exact event and edit only requested fields; this boundary never clicks Save. */
export async function prepareCalendarEventUpdate(
  page: Page,
  event: CalendarEventSnapshot,
  fields: CalendarEventFields,
): Promise<void> {
  page.setDefaultTimeout(20_000)
  const id = Buffer.from(`${event.ref.eventId} ${event.ref.calendarId}`).toString('base64url')
  const url = new URL(`https://calendar.google.com/calendar/r/eventedit/${id}`)
  url.searchParams.set('authuser', event.ref.account)
  url.searchParams.set('hl', 'en')
  url.searchParams.set('ctz', event.fields.timezone)
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  const title = page.getByRole('textbox', { name: 'Title', exact: true })
  try {
    await title.waitFor()
  } catch {
    throw new Error('The event editor could not open. Check the selected account with sky google:browser.')
  }
  const account = await page
    .getByRole('button', { name: /^Google Account:/ })
    .first()
    .ariaSnapshot()
  if (!account.toLowerCase().includes(`(${event.ref.account.toLowerCase()})`))
    throw new Error('The browser is signed in to a different Google account. Nothing was saved.')
  if (await page.getByRole('checkbox', { name: 'All day', exact: true }).isChecked())
    throw new Error('The event editor is all-day. Nothing was saved.')
  const oldEnd = calendarLocal(event.end, event.fields.timezone)
  if (
    (await title.inputValue()) !== event.fields.title ||
    !same(await readTiming(page), {
      date: event.fields.date,
      time: event.fields.time,
      endDate: oldEnd.date,
      endTime: oldEnd.time,
    })
  )
    throw new Error('The event editor differs from the reviewed event or timezone. Reload the event before editing.')
  await verifyGuests(page, event, event.fields)

  const interval = meetingInterval(fields)
  const start = calendarLocal(interval.start, event.fields.timezone)
  const end = calendarLocal(interval.end, event.fields.timezone)
  if (
    interval.startMilliseconds !== calendarInstant(event.start) ||
    interval.endMilliseconds !== calendarInstant(event.end)
  ) {
    for (const [role, name, value] of [
      ['textbox', 'Start date', start.date],
      ['textbox', 'End date', end.date],
      ['combobox', 'Start time', start.time],
      ['combobox', 'End time', end.time],
      ['textbox', 'End date', end.date],
    ] as const) {
      const input = page.getByRole(role, { name, exact: true })
      await input.fill(value)
      await input.press('Tab')
    }
  }
  if (fields.title !== event.fields.title) await title.fill(fields.title)
  if (fields.description !== event.fields.description) {
    const description = page.getByRole('textbox', { name: 'Description', exact: true })
    await description.fill(fields.description)
    if (
      (await description.innerText()).trim().replaceAll('\r\n', '\n') !==
      fields.description.trim().replaceAll('\r\n', '\n')
    )
      throw new Error('Calendar did not keep the new agenda. Nothing was saved.')
  }
  if (fields.location !== event.fields.location) {
    const location = page
      .getByRole('combobox', { name: /location/i })
      .or(page.getByRole('textbox', { name: /location/i }))
      .first()
    await location.fill(fields.location)
    await location.press('Tab')
    if ((await location.inputValue()) !== fields.location)
      throw new Error('Calendar did not keep the new location. Nothing was saved.')
  }
  const wanted = new Set(emails(fields.guests))
  for (const email of emails(event.fields.guests)) {
    if (wanted.has(email)) continue
    // data-email is the exact identity; visible names are allowed to collide.
    const exactRow = page.locator(`[role="treeitem"][data-email=${JSON.stringify(email)}]`)
    await exactRow.getByRole('button', { name: /remove/i }).click()
  }
  const existing = new Set(emails(event.fields.guests))
  for (const guest of fields.guests) {
    if (existing.has(guest.email.toLowerCase())) continue
    const input = page.getByRole('combobox', { name: 'Guests', exact: true })
    await input.fill(guest.email)
    await input.press('Enter')
    await page.waitForFunction(
      (email) =>
        [...document.querySelectorAll('[role="treeitem"][data-email]')].some(
          (item) => item.getAttribute('data-email')?.toLowerCase() === email.toLowerCase(),
        ),
      guest.email,
    )
  }
  await verifyGuests(page, event, fields)
  await preserveConference(page, event)
  if (
    (await title.inputValue()) !== fields.title ||
    !same(await readTiming(page), {
      date: start.date,
      time: start.time,
      endDate: end.date,
      endTime: end.time,
    })
  )
    throw new Error('Calendar did not keep the reviewed title and time. Nothing was saved.')
}

/** A save is complete only after update notifications and exact event readback. */
export async function finishCalendarEventUpdate(
  page: Page,
  event: CalendarEventSnapshot,
  fields: CalendarEventFields,
  read: () => Promise<CalendarEventSnapshot>,
): Promise<CreatedCalendarEvent> {
  let occurrenceChosen = !event.recurring
  let sent = !event.fields.guests.length && !fields.guests.length && !event.resourceEmails.length
  let outsideInvited = false
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!occurrenceChosen) {
      const occurrence = page.getByRole('radio', { name: 'This event', exact: true })
      if (await occurrence.isVisible()) {
        await occurrence.check()
        await page.getByRole('button', { name: 'OK', exact: true }).click()
        occurrenceChosen = true
      }
    }
    const send = page.getByRole('button', { name: 'Send', exact: true })
    if (occurrenceChosen && !sent && (await send.isVisible())) {
      await send.click()
      sent = true
    }
    const outside = page.getByRole('button', { name: 'Invite all guests', exact: true })
    if (!outsideInvited && (await outside.isVisible())) {
      await outside.click()
      outsideInvited = true
    }
    if (occurrenceChosen && sent && !(await page.getByRole('textbox', { name: 'Title', exact: true }).isVisible())) {
      const saved = await read()
      if (savedCalendarUpdateMatches(saved, event, fields))
        return {
          title: saved.fields.title,
          calendarUrl: saved.calendarUrl,
          event: saved.ref,
          conferenceUrl: saved.conferenceUrl,
          zoomUrl: saved.conferenceUrl ? (zoomMeetingUrl(saved.conferenceUrl) ?? '') : '',
        }
    }
    await page.waitForTimeout(500)
  }
  throw new Error('Calendar did not confirm the exact event update and guest notifications.')
}

export async function updateCalendarEvent(
  event: CalendarEventSnapshot,
  fields: CalendarEventFields,
  hooks: Parameters<CalendarSchedulerHost['create']>[1],
  read: () => Promise<CalendarEventSnapshot>,
): Promise<CreatedCalendarEvent> {
  return withGoogleBrowser({ headless: true }, async (context) => {
    const page = await context.newPage()
    try {
      await prepareCalendarEventUpdate(page, event, fields)
      await hooks.beforeSave()
      validateEventUpdate(event, fields, instantNow())
      await hooks.saving()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      return await finishCalendarEventUpdate(page, event, fields, read)
    } finally {
      await page.close().catch(() => undefined)
    }
  })
}
