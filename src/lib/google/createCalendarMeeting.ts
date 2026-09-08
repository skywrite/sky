import type { Page } from 'playwright'
import type { CreatedCalendarEvent } from '#lib/calendarScheduler/types.ts'
import { withGoogleBrowser } from '#lib/google/browserSession.ts'
import { listEvents, type CalendarEvent } from '#lib/google/calendar.ts'
import type { GoogleClient } from '#lib/google/client.ts'
import { calendarInstant, calendarNow, instantNow, PlainDate } from '#universal/dates/nbdt/mod.ts'

export interface CalendarMeeting {
  title: string
  description: string
  account: string
  calendarId: string
  calendarName: string
  date: string
  time: string
  timezone: string
  start: string
  end: string
  endDate: string
  endTime: string
  guests: Array<{ name: string; email: string }>
}

export function zoomMeetingUrl(href: string): string | null {
  try {
    let url = new URL(href)
    if (url.hostname === 'www.google.com' && url.pathname === '/url') {
      const target = url.searchParams.get('q') ?? url.searchParams.get('url')
      if (target) url = new URL(target)
    }
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === 'zoom.us' || url.hostname.endsWith('.zoom.us')) ||
      !/^\/j\/\d+$/.test(url.pathname)
    )
      return null
    return url.toString()
  } catch {
    return null
  }
}

function zoomId(href: string): string | null {
  const url = zoomMeetingUrl(href)
  return url ? new URL(url).pathname : null
}

export function savedMeetingMatches(event: CalendarEvent, meeting: CalendarMeeting, zoomUrl: string): boolean {
  const actual = event.attendees
    .filter((guest) => !guest.self && guest.email.toLowerCase() !== meeting.account.toLowerCase())
    .map((guest) => guest.email.toLowerCase())
    .sort()
  const expected = meeting.guests.map((guest) => guest.email.toLowerCase()).sort()
  return (
    event.status === 'confirmed' &&
    !event.allDay &&
    event.title === meeting.title &&
    calendarInstant(event.start) === calendarInstant(meeting.start) &&
    calendarInstant(event.end) === calendarInstant(meeting.end) &&
    JSON.stringify(actual) === JSON.stringify(expected) &&
    !!event.conferenceUrl &&
    zoomId(event.conferenceUrl) === zoomId(zoomUrl)
  )
}

function templateUrl(meeting: CalendarMeeting): string {
  const url = new URL('https://calendar.google.com/calendar/render')
  url.searchParams.set('action', 'TEMPLATE')
  url.searchParams.set('authuser', meeting.account)
  url.searchParams.set('hl', 'en')
  url.searchParams.set('text', meeting.title)
  url.searchParams.set('details', meeting.description)
  url.searchParams.set('ctz', meeting.timezone)
  const compact = (date: string, time: string) => `${date.replaceAll('-', '')}T${time.replace(':', '')}00`
  url.searchParams.set('dates', `${compact(meeting.date, meeting.time)}/${compact(meeting.endDate, meeting.endTime)}`)
  return url.toString()
}

async function selectCalendar(page: Page, meeting: CalendarMeeting): Promise<void> {
  await page.getByRole('combobox', { name: 'Calendar', exact: true }).click()
  // The calendar's identity, not its mutable display name. The editor uses unpadded base64 IDs.
  const encoded = Buffer.from(meeting.calendarId).toString('base64').replace(/=+$/, '')
  const option = page.locator(`[role="option"][data-value="${encoded}"]`)
  await option.click()
  await page.getByRole('combobox', { name: 'Calendar', exact: true }).evaluate((element) => element.blur())
}

export function formDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parts = /^(\w+) (\d{1,2}), (\d{4})$/.exec(value)
  const month = parts
    ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(parts[1]!) + 1
    : 0
  return month && parts ? `${parts[3]}-${String(month).padStart(2, '0')}-${parts[2]!.padStart(2, '0')}` : ''
}

export function formTime(value: string): string {
  const parts = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(value.trim())
  if (!parts) return ''
  const hour = parts[3] ? (Number(parts[1]) % 12) + (parts[3].toLowerCase() === 'pm' ? 12 : 0) : Number(parts[1])
  return `${String(hour).padStart(2, '0')}:${parts[2]}`
}

/** Prepare and verify an unsaved editor. Kept separate so browser checks never need to send invitations. */
export async function prepareCalendarZoomMeeting(page: Page, meeting: CalendarMeeting): Promise<string> {
  page.setDefaultTimeout(20_000)
  await page.goto(templateUrl(meeting), { waitUntil: 'domcontentloaded', timeout: 45_000 })
  try {
    await page.getByRole('textbox', { name: 'Title', exact: true }).waitFor()
  } catch {
    throw new Error(
      'Google Calendar needs a browser sign-in on the computer running Sky. Run sky google:browser there, then retry.',
    )
  }
  const labels = await page
    .getByRole('button', { name: /^Google Account:/ })
    .first()
    .ariaSnapshot()
  if (!labels.toLowerCase().includes(`(${meeting.account.toLowerCase()})`))
    throw new Error(
      'The Calendar browser is signed in to a different Google account. Sign in to the chosen account first.',
    )
  await selectCalendar(page, meeting)
  if (await page.getByRole('checkbox', { name: 'All day', exact: true }).isChecked())
    throw new Error('Calendar interpreted this as an all-day event. Nothing was saved.')
  if (!(await page.getByRole('combobox', { name: 'Recurrence', exact: true }).innerText()).includes('Does not repeat'))
    throw new Error('Calendar selected a repeating meeting. Nothing was saved.')

  // Choose the provider before adding people; automatic conferencing may otherwise race the guest list.
  await page.getByRole('button', { name: 'Add video conferencing', exact: true }).click()
  try {
    await page.getByRole('menuitem', { name: 'Zoom Meeting', exact: true }).click()
    await page.getByRole('link', { name: 'Join Zoom Meeting', exact: true }).waitFor({ timeout: 30_000 })
  } catch {
    throw new Error(
      'Zoom is not available in this Google Calendar account. Connect the Zoom for Google Workspace add-on, then retry.',
    )
  }
  const description = page.getByRole('textbox', { name: 'Description', exact: true })
  await description.fill(meeting.description)
  if (
    (await description.innerText()).trim().replaceAll('\r\n', '\n') !==
    meeting.description.trim().replaceAll('\r\n', '\n')
  ) {
    throw new Error('Calendar did not keep the agenda. Nothing was saved.')
  }
  for (const guest of meeting.guests) {
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
  const guests = await page
    .getByRole('tabpanel', { name: 'Guests', exact: true })
    .locator('[role="treeitem"][data-email]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-email')!.toLowerCase()))
  const actual = [...new Set(guests)].filter((email) => email !== meeting.account.toLowerCase()).sort()
  const expected = meeting.guests.map((guest) => guest.email.toLowerCase()).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Calendar did not keep the exact guest list. Nothing was saved.')
  const readDate = async (name: string) => formDate(await page.getByRole('textbox', { name, exact: true }).inputValue())
  const readTime = async (name: string) =>
    formTime(await page.getByRole('combobox', { name, exact: true }).inputValue())
  if (
    (await page.getByRole('textbox', { name: 'Title', exact: true }).inputValue()) !== meeting.title ||
    (await readDate('Start date')) !== meeting.date ||
    (await readDate('End date')) !== meeting.endDate ||
    (await readTime('Start time')) !== meeting.time ||
    (await readTime('End time')) !== meeting.endTime
  ) {
    throw new Error('Calendar did not keep the reviewed title, date, and time. Nothing was saved.')
  }
  const zoomUrl = zoomMeetingUrl(
    (await page.getByRole('link', { name: 'Join Zoom Meeting', exact: true }).getAttribute('href')) ?? '',
  )
  if (!zoomUrl) throw new Error('Calendar did not return a Zoom meeting link. Nothing was saved.')
  return zoomUrl
}

/** Finish Google's invitation prompts and verify the event before reporting that invitations were sent. */
export async function finishCalendarInvitation(
  page: Page,
  meeting: CalendarMeeting,
  zoomUrl: string,
  read: () => Promise<CalendarEvent[]>,
): Promise<CreatedCalendarEvent> {
  let sent = false
  let invitedOutside = false
  for (let attempt = 0; attempt < 40; attempt++) {
    const send = page.getByRole('button', { name: 'Send', exact: true })
    if (!sent && (await send.isVisible())) {
      await send.click()
      sent = true
    }
    const outside = page.getByRole('button', { name: 'Invite all guests', exact: true })
    if (!invitedOutside && (await outside.isVisible())) {
      await outside.click()
      invitedOutside = true
    }
    // The editor can disappear before either confirmation arrives. Its disappearance alone is not a send.
    if (sent && !(await page.getByRole('textbox', { name: 'Title', exact: true }).isVisible())) {
      const saved = (await read()).find((event) => savedMeetingMatches(event, meeting, zoomUrl))
      if (saved?.htmlLink)
        return {
          title: saved.title,
          calendarUrl: saved.htmlLink,
          zoomUrl: saved.conferenceUrl!,
          event: { account: meeting.account, calendarId: meeting.calendarId, eventId: saved.id },
        }
    }
    await page.waitForTimeout(500)
  }
  throw new Error('Calendar did not confirm both the invitation send and the saved meeting.')
}

export async function createCalendarZoomMeeting(
  client: GoogleClient,
  meeting: CalendarMeeting,
  hooks: { beforeSave: () => Promise<void>; saving: () => Promise<void> },
): Promise<CreatedCalendarEvent> {
  const day = new PlainDate(meeting.date)
  const read = () =>
    listEvents(client, {
      calendarId: meeting.calendarId,
      timeMin: `${day.addDays(-1).ymd}T00:00:00Z`,
      timeMax: `${day.addDays(2).ymd}T00:00:00Z`,
      timeZone: meeting.timezone,
    })
  // Refuse a link already in use around this meeting or in the organizer's recent calendar.
  const previous = await listEvents(client, {
    calendarId: meeting.calendarId,
    timeMin: `${calendarNow(meeting.timezone).plainDate.addDays(-30).ymd}T00:00:00Z`,
    timeMax: `${day.addDays(2).ymd}T00:00:00Z`,
    timeZone: meeting.timezone,
  })
  const used = new Set(previous.flatMap((event) => (event.conferenceUrl ? [zoomId(event.conferenceUrl)] : [])))
  return withGoogleBrowser({ headless: true }, async (context) => {
    const page = await context.newPage()
    try {
      const zoomUrl = await prepareCalendarZoomMeeting(page, meeting)
      if (used.has(zoomId(zoomUrl)))
        throw new Error(
          'Zoom did not provide a fresh meeting link. Set the Calendar add-on to generate a new meeting ID, then retry.',
        )
      await hooks.beforeSave()
      if (calendarInstant(meeting.start) <= calendarInstant(instantNow()))
        throw new Error('This meeting time has passed. Choose a future time.')
      await hooks.saving()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      return await finishCalendarInvitation(page, meeting, zoomUrl, read)
    } finally {
      await page.close().catch(() => undefined)
    }
  })
}
