import { Hono } from 'hono'
import { z } from 'zod'
import { hold } from '../../activity.ts'
import type { FutureStore } from './store.ts'
import { FutureError } from './types.ts'
import type { DecisionWizard } from './wizard.ts'

export interface FutureRoutesOptions {
  store: FutureStore
  /** The decision wizard; without it decisions are listed but not added */
  wizard?: DecisionWizard
}

export function createFutureRoutes({ store, wizard }: FutureRoutesOptions): Hono {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.method !== 'POST') return next()
    const origin = c.req.header('origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('sec-fetch-site') === 'cross-site')
      return c.json({ message: 'Open Future in Sky to make this change.' }, 403)
    if (!c.req.header('content-type')?.startsWith('application/json'))
      return c.json({ message: 'Expected a JSON request.' }, 415)
    const release = hold('saving in Future')
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
  app.get('/goals/:name', async (c) => c.json(await store.goal(c.req.param('name'))))
  app.post('/goals/:name/date', async (c) => c.json(await store.setDate(c.req.param('name'), await c.req.json())))
  app.post('/goals/:name/close', async (c) => c.json(await store.closeGoal(c.req.param('name'), await c.req.json())))
  app.post('/goals/:name/reopen', async (c) => c.json(await store.reopenGoal(c.req.param('name'))))
  app.post('/goals/:name/number', async (c) => c.json(await store.setNumber(c.req.param('name'), await c.req.json())))
  app.post('/goals/:name/checkpoints', async (c) =>
    c.json(await store.addCheckpoint(c.req.param('name'), await c.req.json())),
  )
  app.post('/goals/:name/checkpoints/remove', async (c) =>
    c.json(await store.removeCheckpoint(c.req.param('name'), await c.req.json())),
  )

  // The decision wizard: a run thinks in the background, and the page reads it to see where it stands.
  const runs = (): DecisionWizard => {
    if (!wizard) throw new FutureError('Decisions cannot be added from here.', 503)
    return wizard
  }
  const again = z.object({ again: z.boolean().default(false) })
  app.get('/decisions/finds', async (c) => c.json(await runs().finds(await store.decisionTitles())))
  app.post('/decisions/finds', async (c) =>
    c.json(await runs().finds(await store.decisionTitles(), again.parse(await c.req.json()).again)),
  )
  app.post('/decisions/wizard', async (c) => c.json(await runs().start(await c.req.json()), 201))
  app.get('/decisions/wizard/:id', async (c) => c.json(await runs().get(c.req.param('id'))))
  app.get('/decisions/wizard/:id/chat', async (c) => c.json(await runs().chat(c.req.param('id'))))
  app.post('/decisions/wizard/:id/progress', async (c) =>
    c.json(await runs().progress(c.req.param('id'), await c.req.json())),
  )
  app.post('/decisions/wizard/:id/add', async (c) => c.json(await runs().add(c.req.param('id'), await c.req.json())))
  app.post('/decisions/wizard/:id/drop', async (c) => c.json(await runs().dropAddition(c.req.param('id'))))
  app.post('/decisions/wizard/:id/reword', async (c) =>
    c.json(await runs().reword(c.req.param('id'), await c.req.json())),
  )
  app.post('/decisions/wizard/:id/retry', async (c) => c.json(await runs().retry(c.req.param('id'))))
  app.post('/decisions/wizard/:id/open', async (c) => c.json(await runs().saveOpen(c.req.param('id'))))
  app.post('/decisions/wizard/:id/save', async (c) => c.json(await runs().save(c.req.param('id'))))
  app.post('/decisions/wizard/:id/discard', async (c) => {
    await runs().discard(c.req.param('id'))
    return c.json({ discarded: true })
  })
  return app
}
