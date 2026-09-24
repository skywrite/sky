import { spyOn } from 'bun:test'
import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { CALENDAR_READONLY_SCOPE } from '#lib/google/calendar.ts'
import { saveAccountTokens, saveOAuthClient } from '#lib/google/tokens.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import * as sys from '#lib/sys/mod.ts'
import { makeTempDir, outputFile } from '#shared/fs/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { fetchDayMeetings } from './dayMeetings.ts'

/** A day file as the notebook writes one: its frontmatter, then the heading that names its date. */
function dayFileText(day: PlainDate, frontmatter: string): string {
  return `---\n${frontmatter}\n---\n\n# **${day.ymd} - ${day.dayShort}**\n`
}

test('calendar day timezone falls back for missing days and new notebooks', async () => {
  const timeDir = await makeTempDir({ prefix: 'sky-calendar-timezone-' })
  const systemZone = spyOn(sys, 'readSystemTimezone').mockResolvedValue('America/Los_Angeles')
  const secrets = new TestSecretsProvider()
  const today = PlainDate.today()
  const day = today.addDays(-400)
  const zone = async () => (await fetchDayMeetings(secrets, day, timeDir)).timeZone
  try {
    const newNotebook = await zone()
    await outputFile(
      path.join(timeDir, dayFile(today)),
      dayFileText(today, `date: ${today.ymd}\nstarted: 07:00\ntz: Europe/London`),
    )
    const missingDay = await zone()
    await outputFile(
      path.join(timeDir, dayFile(day)),
      dayFileText(day, `date: ${day.ymd}\nstarted: 07:00\ntz: America/Chicago`),
    )
    const savedDay = await zone()
    await outputFile(path.join(timeDir, dayFile(day)), dayFileText(day, `date: ${day.ymd}\nstarted: 07:00`))
    assert({
      given: 'a new notebook, a missing day, a saved day in another zone, and a legacy day without tz',
      should: 'use the system, current notebook, saved day, and day-model default zones respectively',
      actual: [newNotebook, missingDay, savedDay, await zone()],
      expected: ['America/Los_Angeles', 'Europe/London', 'America/Chicago', 'America/Chicago'],
    })
  } finally {
    systemZone.mockRestore()
    await rm(timeDir, { recursive: true, force: true })
  }
})

test('calendar events belong to the date in the saved day timezone', async () => {
  const timeDir = await makeTempDir({ prefix: 'sky-calendar-midnight-' })
  const day = new PlainDate('2026-07-14')
  const secrets = new TestSecretsProvider()
  const systemZone = spyOn(sys, 'readSystemTimezone').mockResolvedValue('America/Los_Angeles')
  const request = spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
    const central = new URL(String(input)).searchParams.get('timeZone') === 'America/Chicago'
    return Response.json({
      items: [0, 1].map((index) => {
        const date = day.addDays(index + (central ? 0 : -1)).ymd
        const hour = central ? '00' : '22'
        const offset = central ? '-05:00' : '-07:00'
        return {
          id: `call-${index}`,
          summary: 'Atlas support call',
          start: { dateTime: `${date}T${hour}:30:00${offset}` },
          end: { dateTime: `${date}T${hour}:45:00${offset}` },
          attendees: [{ email: 'jane@example.com' }],
        }
      }),
    })
  }) as typeof fetch)
  try {
    await outputFile(path.join(timeDir, dayFile(day)), dayFileText(day, `date: ${day.ymd}\ntz: America/Chicago`))
    await saveOAuthClient(secrets, { clientId: 'mock-client', clientSecret: 'mock-secret' })
    await saveAccountTokens(secrets, 'owner@example.com', {
      accessToken: 'mock-access',
      refreshToken: 'mock-refresh',
      scopes: [CALENDAR_READONLY_SCOPE],
    })
    const calendar = await fetchDayMeetings(secrets, day, timeDir)
    assert({
      given: 'two calls just after midnight in Central time, on consecutive days, viewed from Pacific time',
      should: 'keep the requested day’s call and exclude the following day’s call',
      actual: [calendar.timeZone, calendar.meetings.map((event) => [event.id, event.start]), calendar.errors],
      expected: ['America/Chicago', [['call-0', '2026-07-14T00:30:00-05:00']], []],
    })
  } finally {
    request.mockRestore()
    systemZone.mockRestore()
    await rm(timeDir, { recursive: true, force: true })
  }
})
