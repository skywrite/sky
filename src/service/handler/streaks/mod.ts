import { Hono } from 'hono'
import { z } from 'zod'
import { OutboxError } from '#lib/outbox/types.ts'
import { hold } from '../../activity.ts'
import { StreaksError, StreaksStore } from './store.ts'

export interface StreaksRoutesOptions {
  store: StreaksStore
}

export function createStreaksRoutes({ store }: StreaksRoutesOptions): Hono {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.method !== 'POST') return next()
    const origin = c.req.header('origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('sec-fetch-site') === 'cross-site')
      return c.json({ message: 'Open Streaks in Sky to make this change.' }, 403)
    if (!c.req.header('content-type')?.startsWith('application/json'))
      return c.json({ message: 'Expected a JSON request.' }, 415)
    const release = hold('saving streaks')
    try {
      await next()
    } finally {
      release()
    }
  })
  app.onError((error, c) =>
    c.json(
      {
        message: error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join('; ') : error.message,
      },
      error instanceof StreaksError || error instanceof OutboxError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500,
    ),
  )
  app.get('/report', async (c) => c.json(await store.report()))
  app.post('/create', async (c) => c.json(await store.create(await c.req.json()), 201))
  app.post('/:name/completion', async (c) => c.json(await store.completion(c.req.param('name'), await c.req.json())))
  app.post('/:name/archive', async (c) => c.json(await store.archive(c.req.param('name'), await c.req.json())))
  app.post('/undo', async (c) => {
    const { id } = z.object({ id: z.uuid() }).parse(await c.req.json())
    return c.json(await store.undo(id))
  })
  return app
}
