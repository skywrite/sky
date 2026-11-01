import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { ItemEditError } from '#lib/nbfs/listBlocks.ts'
import { hold } from '../../activity.ts'
import { RecurringError, RecurringStore } from './store.ts'

export function createRecurringRoutes(store: RecurringStore): Hono {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 256 * 1024 }))
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.method === 'GET') return next()
    const origin = c.req.header('origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('sec-fetch-site') === 'cross-site')
      return c.json({ message: 'Open Recurring directly in Sky to make this change.' }, 403)
    if (!c.req.header('content-type')?.startsWith('application/json'))
      return c.json({ message: 'Expected a JSON request.' }, 415)
    const release = hold('saving recurring items')
    try {
      await next()
    } finally {
      release()
    }
  })
  app.onError((error, c) =>
    c.json(
      {
        message:
          error instanceof z.ZodError ? (error.issues[0]?.message ?? 'Check the recurring item.') : error.message,
      },
      error instanceof RecurringError || error instanceof ItemEditError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500,
    ),
  )
  app.get('/', async (c) => c.json(await store.report()))
  app.get('/preview', (c) => c.json(store.preview(c.req.query('pattern') ?? '')))
  app.post('/save', async (c) => c.json(await store.save(await c.req.json())))
  app.post('/remove', async (c) => c.json(await store.remove(await c.req.json())))
  return app
}
