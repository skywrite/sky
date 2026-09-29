import { Hono } from 'hono'
import { z } from 'zod'
import { calendarDraftIdsSchema } from '#lib/calendarScheduler/batch.ts'
import { CalendarScheduler } from '#lib/calendarScheduler/CalendarScheduler.ts'
import type { CalendarSchedulerHost } from '#lib/calendarScheduler/types.ts'
import { hold } from '../../activity.ts'
import { CalendarBrowserConnection } from './browserSignIn.ts'

export function createMeetingRoutes(host: CalendarSchedulerHost): Hono {
  const app = new Hono()
  const scheduler = new CalendarScheduler(host, { hold: () => hold('saving a calendar event') })
  const browser = host.browser && new CalendarBrowserConnection(host.browser, () => hold('Google browser sign-in'))
  const browserAccount = async (value: unknown) => {
    const account = z.email().max(254).parse(value).toLowerCase()
    if (!(await host.setup()).accounts.includes(account)) throw new Error('Choose a connected Google account first.')
    if (!browser) throw new Error('Google browser sign-in is not available on this service.')
    return account
  }

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

  app.get('/setup', async (c) => c.json(await scheduler.setup()))
  app.get('/browser', async (c) => {
    const account = await browserAccount(c.req.query('account'))
    return c.json(browser!.status(account))
  })
  for (const action of ['check', 'sign-in', 'cancel'] as const) {
    app.post(`/browser/${action}`, async (c) => {
      const input = z
        .object({ account: z.string() })
        .strict()
        .parse(await c.req.json())
      const account = await browserAccount(input.account)
      return c.json(
        action === 'sign-in'
          ? browser!.signIn(account)
          : action === 'cancel'
            ? browser!.cancel(account)
            : browser!.status(account, true),
      )
    })
  }
  app.get('/people', async (c) => c.json(await scheduler.people(c.req.query('q') ?? '')))
  app.get('/drafts/:id/approval', async (c) =>
    c.json(await scheduler.approval(c.req.param('id'), z.enum(['schedule', 'update']).parse(c.req.query('operation')))),
  )
  app.post('/parse', async (c) => c.json(await scheduler.parse(await c.req.json(), c.req.raw.signal)))
  app.post('/preview', async (c) => c.json(await scheduler.preview(await c.req.json())))
  app.post('/prepare', async (c) => c.json(await scheduler.prepare(await c.req.json(), c.req.raw.signal)))
  app.post('/review', async (c) => c.json(await scheduler.review(await c.req.json())))
  app.post('/retry-review', async (c) => {
    const { draftId } = z
      .object({ draftId: z.uuid() })
      .strict()
      .parse(await c.req.json())
    return c.json(await scheduler.retryReview(draftId))
  })
  app.post('/retry', async (c) => c.json(await scheduler.retry(await c.req.json()), 202))
  app.post('/updates/prepare', async (c) => c.json(await scheduler.prepareUpdate(await c.req.json(), c.req.raw.signal)))
  app.post('/updates/review', async (c) => c.json(await scheduler.reviewUpdate(await c.req.json())))
  app.post('/update', async (c) => {
    const { draftId } = z
      .object({ draftId: z.uuid() })
      .strict()
      .parse(await c.req.json())
    return c.json(await scheduler.update(draftId), 202)
  })
  app.post('/create', async (c) => c.json(await scheduler.create(await c.req.json()), 202))
  app.post('/send', async (c) => {
    const { draftId } = z
      .object({ draftId: z.uuid() })
      .strict()
      .parse(await c.req.json())
    return c.json(await scheduler.send(draftId), 202)
  })
  app.post('/send-batch', async (c) => {
    const { draftIds } = z
      .object({ draftIds: calendarDraftIdsSchema })
      .strict()
      .parse(await c.req.json())
    return c.json(await scheduler.sendBatch(draftIds), 202)
  })
  app.get('/jobs/:id', async (c) => {
    const job = await scheduler.get(c.req.param('id'))
    return job ? c.json(job) : c.json({ message: 'Meeting request not found.' }, 404)
  })
  return app
}
