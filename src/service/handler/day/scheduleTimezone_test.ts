import { spyOn } from 'bun:test'
import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { checkDayMeetings } from '#commands/all/day/meeting/lib/meetingCheck.ts'
import { CALENDAR_READONLY_SCOPE } from '#lib/google/calendar.ts'
import { saveAccountTokens, saveOAuthClient } from '#lib/google/tokens.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import * as sys from '#lib/sys/mod.ts'
import { makeTempDir, outputFile } from '#shared/fs/mod.ts'
import * as nbfs from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createDayScheduleHost } from './schedule.ts'

for (const [ymd, centralOffset, pacificOffset] of [
  ['2026-01-27', '-06:00', '-08:00'],
  ['2026-07-14', '-05:00', '-07:00'],
]) {
  test(`day meetings keep the starting timezone after travel (${ymd})`, async () => {
    const base = await makeTempDir({ prefix: 'sky-meeting-timezone-' })
    const timeDir = path.join(base, 'time')
    const day = new PlainDate(ymd)
    const secrets = new TestSecretsProvider()
    const zones: Array<string | null> = []
    const recordPath = path.join('time', nbfs.dayDir(day), 'actions/meetings/10-00_Planning.md')
    const spies = [
      spyOn(sys, 'readSystemTimezone').mockResolvedValue('America/Los_Angeles'),
      spyOn(nbfs, 'fetchNow').mockResolvedValue(new ZonedDateTime(`${ymd} 10:15`, 'America/Chicago')),
      spyOn(KeychainSecretsProvider.prototype, 'get').mockImplementation((category, name) =>
        secrets.get(category, name),
      ),
      spyOn(KeychainSecretsProvider.prototype, 'list').mockImplementation((category) => secrets.list(category)),
      spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
        const url = new URL(String(input))
        if (url.pathname === '/graphql') {
          return Response.json({
            data: {
              meetings: [
                {
                  who: 'Jane Doe',
                  medium: 'Zoom',
                  when: { datetime: `${ymd} 10:00`, end: `${ymd} 10:30` },
                },
              ],
            },
          })
        }
        if (url.hostname !== 'www.googleapis.com') throw new Error(`Unexpected request: ${url}`)
        const zone = url.searchParams.get('timeZone')
        zones.push(zone)
        const central = zone === 'America/Chicago'
        const hour = central ? '10' : '08'
        const offset = central ? centralOffset : pacificOffset
        return Response.json({
          items: [
            {
              id: 'atlas-planning',
              summary: 'Atlas sync',
              start: { dateTime: `${ymd}T${hour}:00:00${offset}` },
              end: { dateTime: `${ymd}T${hour}:30:00${offset}` },
              attendees: [{ email: 'jane@example.com', displayName: 'Jane Doe', responseStatus: 'accepted' }],
            },
          ],
        })
      }) as typeof fetch),
    ]
    try {
      await outputFile(
        path.join(timeDir, nbfs.dayFile(day)),
        `---\ndate: ${ymd}\nstarted: 07:00\ntz: America/Chicago\n---\n` +
          '## Professional Complete\n' +
          '- 10:00 > Jane Doe Zoom -> [Planning notes](actions/meetings/10-00_Planning.md)\n',
      )
      await outputFile(
        path.join(base, recordPath),
        `---\nwho: Jane Doe\nwhen: ${ymd} 10:00 - 10:30\n---\n` +
          '# Planning notes\n\nWe discussed the next release and agreed on the next steps.\n',
      )
      await saveOAuthClient(secrets, { clientId: 'mock-client', clientSecret: 'mock-secret' })
      await saveAccountTokens(secrets, 'owner@example.com', {
        accessToken: 'mock-access',
        refreshToken: 'mock-refresh',
        scopes: [CALENDAR_READONLY_SCOPE],
      })

      const schedule = await createDayScheduleHost({ timeDir, markdownBaseDir: base })(day)
      assert({
        given: 'a Central-time day and its filed meeting, viewed after moving to Pacific time',
        should: 'show one meeting at the original time, linked to its record and judged against the notebook clock',
        actual: {
          read: schedule.read,
          errors: schedule.errors,
          meetings: schedule.meetings.map((meeting) => ({
            start: meeting.start,
            end: meeting.end,
            state: meeting.state,
            record: meeting.record?.path,
          })),
        },
        expected: {
          read: true,
          errors: [],
          meetings: [{ start: '10:00', end: '10:30', state: 'now', record: recordPath }],
        },
      })

      const check = await checkDayMeetings(secrets, day, timeDir)
      assert({
        given: 'the same day checked by the CLI, chat, or voice',
        should: 'recognize the meeting as recorded in the saved day timezone',
        actual: [check.timeZone, check.meetings.map((meeting) => meeting.record?.who ?? null), check.errors, zones],
        expected: ['America/Chicago', ['Jane Doe'], [], ['America/Chicago', 'America/Chicago']],
      })
    } finally {
      for (const spy of spies) spy.mockRestore()
      await rm(base, { recursive: true, force: true })
    }
  })
}
