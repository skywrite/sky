import { Hono } from 'hono'
import { z } from 'zod'
import { hold } from '../../activity.ts'
import type { FutureStore } from './store.ts'
import { FutureError } from './types.ts'

export interface FutureRoutesOptions {
  store: FutureStore
}

export function createFutureRoutes({ store }: FutureRoutesOptions): Hono {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.method !== 'POST') return next()
    const origin = c.req.header('origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('sec-fetch-site') === 'cross-site')
      return c.json({ message: 'Open Future in Sky to make this change.' }, 403)
    if (!c.req.header('content-type')?.startsWith('application/json'))
      return c.json({ message: 'Expected a JSON request.' }, 415)
    const release = hold('saving a goal')
    try {
      await next()
    } finally {
      release()
    }
  })
  app.onError((error, c) =>
    c.json(
      { message: error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join('; ') : error.message },
      error instanceof FutureError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500,
    ),
  )
  app.get('/report', async (c) => c.json(await store.report()))
  app.post('/goals', async (c) => c.json(await store.createGoal(await c.req.json()), 201))
  app.post('/goals/:name/number', async (c) => c.json(await store.setNumber(c.req.param('name'), await c.req.json())))
  app.post('/goals/:name/checkpoints', async (c) =>
    c.json(await store.addCheckpoint(c.req.param('name'), await c.req.json())),
  )
  app.post('/goals/:name/checkpoints/remove', async (c) =>
    c.json(await store.removeCheckpoint(c.req.param('name'), await c.req.json())),
  )
  return app
}
