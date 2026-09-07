import { Hono } from 'hono'
import { z } from 'zod'
import { calendarInstant, instantNow } from '#universal/dates/nbdt/mod.ts'
import { MeetingJobs } from './jobs.ts'
import type { MeetingsHost } from './types.ts'
import { meetingInterval, meetingTimingSchema, validateMeeting } from './validation.ts'

export function createMeetingRoutes(host: MeetingsHost): Hono {
  const app = new Hono()
  const jobs = new MeetingJobs(host)

  app.use('*', async (c, next) => {
    if (c.req.method === 'POST') {
      const origin = c.req.header('origin')
      if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('sec-fetch-site') === 'cross-site') {
        return c.json({ message: 'Open the meeting composer in Sky to continue.' }, 403)
      }
      if (!c.req.header('content-type')?.includes('application/json'))
        return c.json({ message: 'Expected a JSON request.' }, 415)
    }
    await next()
  })
  app.onError((error, c) =>
    c.json(
      { message: error instanceof z.ZodError ? 'Check the meeting details and email addresses.' : error.message },
      400,
    ),
  )

  app.get('/setup', async (c) => c.json(await host.setup()))
  app.get('/people', async (c) => c.json(await host.people((c.req.query('q') ?? '').slice(0, 200))))
  app.post('/parse', async (c) => {
    const { query, timezone } = z
      .object({ query: z.string().trim().min(1).max(4000), timezone: z.string().min(1).max(100) })
      .parse(await c.req.json())
    return c.json(await host.parse(query, timezone, c.req.raw.signal))
  })
  app.post('/preview', async (c) => {
    const timing = meetingTimingSchema.parse(await c.req.json())
    meetingInterval(timing)
    return c.json(await host.availability(timing))
  })
  app.post('/create', async (c) => {
    const body = z
      .object({ id: z.uuid(), fields: z.unknown(), reviewKey: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(await c.req.json())
    const fields = validateMeeting(body.fields)
    // A retry of an existing request only retrieves its result, even if its time has since passed.
    if (!(await jobs.get(body.id))) {
      if (meetingInterval(fields).startMilliseconds <= calendarInstant(instantNow()))
        throw new Error('Choose a future meeting time.')
      const setup = await host.setup()
      if (!setup.accounts.includes(fields.account)) throw new Error('Choose a connected Google account.')
    }
    return c.json(await jobs.start(body.id, fields, body.reviewKey), 202)
  })
  app.get('/jobs/:id', async (c) => {
    const job = await jobs.get(c.req.param('id'))
    return job ? c.json(job) : c.json({ message: 'Meeting request not found.' }, 404)
  })
  return app
}
