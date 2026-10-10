import { spyOn } from 'bun:test'
import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { CALENDAR_READONLY_SCOPE } from '#lib/google/calendar.ts'
import { saveAccountTokens, saveOAuthClient } from '#lib/google/tokens.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import * as sys from '#lib/sys/mod.ts'
import { makeTempDir, outputFile } from '#shared/fs/mod.ts'
import * as nbfs from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createDayScheduleHost } from './schedule.ts'

test('day meetings still answer on a notebook with no started day', async () => {
  const base = await makeTempDir({ prefix: 'sky-schedule-clock-' })
  const timeDir = path.join(base, 'time')
  const day = new PlainDate('2026-01-27')
  const secrets = new TestSecretsProvider()
  const spies = [
    spyOn(sys, 'readSystemTimezone').mockResolvedValue('America/Chicago'),
    spyOn(KeychainSecretsProvider.prototype, 'get').mockImplementation((category, name) => secrets.get(category, name)),
    spyOn(KeychainSecretsProvider.prototype, 'list').mockImplementation((category) => secrets.list(category)),
    spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
      const url = new URL(String(input))
      if (url.pathname === '/graphql') return Response.json({ data: { meetings: [] } })
      if (url.hostname !== 'www.googleapis.com') throw new Error(`Unexpected request: ${url}`)
      return Response.json({
        items: [
          {
            id: 'atlas-planning',
            summary: 'Atlas sync',
            start: { dateTime: '2026-01-27T10:00:00-06:00' },
            end: { dateTime: '2026-01-27T10:30:00-06:00' },
            attendees: [{ email: 'jane@example.com', displayName: 'Jane Doe', responseStatus: 'accepted' }],
          },
        ],
      })
    }) as typeof fetch),
  ]
  try {
    // A day prepared by a task move, in a notebook nobody has started: no notebook clock to read.
    await outputFile(
      path.join(timeDir, nbfs.dayFile(day)),
      '---\ndate: 2026-01-27\n---\n\n## Professional Todos\n\n- Call Jane\n',
    )
    await saveOAuthClient(secrets, { clientId: 'mock-client', clientSecret: 'mock-secret' })
    await saveAccountTokens(secrets, 'owner@example.com', {
      accessToken: 'mock-access',
      refreshToken: 'mock-refresh',
      scopes: [CALENDAR_READONLY_SCOPE],
    })

    const schedule = await createDayScheduleHost({ timeDir, markdownBaseDir: base })(day)
    assert({
      given: 'a calendar meeting on a day whose notebook has no started day anywhere',
      should: "answer the schedule against the machine's clock instead of failing the rail",
      actual: {
        read: schedule.read,
        errors: schedule.errors,
        meetings: schedule.meetings.map((meeting) => ({
          title: meeting.title,
          start: meeting.start,
          end: meeting.end,
        })),
      },
      expected: { read: true, errors: [], meetings: [{ title: 'Atlas sync', start: '10:00', end: '10:30' }] },
    })
  } finally {
    for (const spy of spies) spy.mockRestore()
    await rm(base, { recursive: true, force: true })
  }
})
