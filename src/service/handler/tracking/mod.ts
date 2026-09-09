import { Hono } from 'hono'
import { z } from 'zod'
import { writeTrackingCsv } from '#commands/all/track/lib/csv.ts'
import { EntryRefSchema, OperationSchema, RevisionSchema, TrackingStore } from '#lib/tracking/store.ts'
import { TrackingError } from '#lib/tracking/types.ts'
import { hold } from '../../activity.ts'

export interface TrackingRoutesOptions {
  store: TrackingStore
}

const reportDays = (value?: string): number | 'all' => (value === 'all' ? 'all' : Number(value ?? 30))

export function createTrackingRoutes({ store }: TrackingRoutesOptions): Hono {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.method === 'POST') {
      const origin = c.req.header('origin')
      if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('sec-fetch-site') === 'cross-site')
        return c.json({ message: 'Open Tracking in Sky to make this change.' }, 403)
      if (!c.req.header('content-type')?.includes('application/json'))
        return c.json({ message: 'Expected a JSON request.' }, 415)
      const release = hold('saving tracking')
      try {
        await next()
      } finally {
        release()
      }
    } else await next()
  })
  app.onError((error, c) =>
    c.json(
      { message: error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join('; ') : error.message },
      error instanceof TrackingError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500,
    ),
  )
  app.get('/report', async (c) =>
    c.json(
      await store.report(
        c.req.query('start'),
        c.req.query('end'),
        c.req.query('name'),
        reportDays(c.req.query('days')),
      ),
    ),
  )
  app.post('/create', async (c) => {
    const body = await c.req.json()
    const { operationId } = OperationSchema.parse(body)
    return c.json(await store.create(operationId, body.tracker), 201)
  })
  app.post('/:name/configure', async (c) => {
    const body = await c.req.json()
    const { operationId, revision } = RevisionSchema.parse(body)
    return c.json(await store.configure(c.req.param('name'), operationId, revision, body.tracker))
  })
  app.post('/:name/status', async (c) => {
    const { operationId, revision, status } = RevisionSchema.extend({ status: z.enum(['active', 'archived']) }).parse(
      await c.req.json(),
    )
    return c.json(await store.setStatus(c.req.param('name'), operationId, revision, status))
  })
  app.post('/:name/entries', async (c) => c.json(await store.saveEntry(c.req.param('name'), await c.req.json())))
  app.post('/:name/entries/delete', async (c) => {
    const { operationId, entry } = OperationSchema.extend({ entry: EntryRefSchema }).parse(await c.req.json())
    return c.json(await store.deleteEntry(c.req.param('name'), operationId, entry))
  })
  app.post('/:name/parse', async (c) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(10_000) }).parse(await c.req.json())
    return c.json(await store.preview(c.req.param('name'), text))
  })
  app.post('/undo', async (c) => {
    const { id } = z.object({ id: z.uuid() }).parse(await c.req.json())
    await store.undo(id)
    return c.json({ undone: true })
  })
  app.get('/:name/export', async (c) => {
    const report = await store.report(
      c.req.query('start'),
      c.req.query('end'),
      c.req.param('name'),
      reportDays(c.req.query('days')),
    )
    const metric = report.metrics[0]
    if (!metric) return c.json({ message: report.errors[0]?.message ?? 'Tracker not found.' }, 404)
    const names = [
      ...new Set([
        ...metric.tracker.columns.map((column) => column.name),
        ...metric.entries.flatMap((entry) => Object.keys(entry.values)),
      ]),
    ]
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header(
      'Content-Disposition',
      `attachment; filename="tracking.csv"; filename*=UTF-8''${encodeURIComponent(metric.tracker.name)}.csv`,
    )
    return c.body(
      writeTrackingCsv(
        ['date', ...names],
        metric.entries.map((entry) => [entry.date, ...names.map((name) => entry.values[name] ?? '')]),
      ),
    )
  })
  return app
}
