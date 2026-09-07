import { Hono } from 'hono'
import { z } from 'zod'
import { OutboxError, type OutboxRecord, type ScanReport } from '#lib/outbox/types.ts'

export type OutboxReport = {
  items: OutboxRecord[]
  preferences: { text: string; revision: string }
  automation: { name: string; status: 'active' | 'paused' } | null
  lastScan: (ScanReport & { at: string }) | null
}

export type OutboxScanResult = { outcome: ScanReport['outcome']; message?: string }

export type OutboxRoutesOptions = {
  report: () => Promise<OutboxReport>
  setup: () => Promise<unknown>
  scan: () => Promise<OutboxScanResult>
  save: (id: string, revision: string, draft: string) => Promise<OutboxRecord>
  dismiss: (id: string, revision: string) => Promise<OutboxRecord>
  approve: (id: string, revision: string, draft: string, reviewedChanges: boolean) => Promise<OutboxRecord>
  preferences: (text: string, revision: string) => Promise<void>
}

const Revision = z.object({ revision: z.string().min(1) })
const Draft = Revision.extend({ draft: z.string().max(20_000) })

export function createOutboxRoutes(host: OutboxRoutesOptions): Hono {
  const app = new Hono()
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site') {
      return c.json({ message: 'Open Outbox from the Sky app.' }, 403)
    }
    if (c.req.method !== 'GET' && !c.req.header('Content-Type')?.startsWith('application/json')) {
      return c.json({ message: 'Expected a JSON request.' }, 400)
    }
    await next()
  })
  app.onError((error, c) => c.json({ message: error.message }, error instanceof OutboxError ? error.status : 400))
  app.get('/status', async (c) => c.json(await host.report()))
  app.post('/setup', async (c) => c.json(await host.setup()))
  app.post('/scan', async (c) => c.json(await host.scan()))
  app.put('/item/:id', async (c) => {
    const data = Draft.parse(await c.req.json())
    return c.json(await host.save(c.req.param('id'), data.revision, data.draft))
  })
  app.post('/item/:id/approve', async (c) => {
    const data = Draft.extend({ reviewedChanges: z.boolean().default(false) }).parse(await c.req.json())
    return c.json(await host.approve(c.req.param('id'), data.revision, data.draft, data.reviewedChanges))
  })
  app.post('/item/:id/dismiss', async (c) => {
    const data = Revision.parse(await c.req.json())
    return c.json(await host.dismiss(c.req.param('id'), data.revision))
  })
  app.put('/preferences', async (c) => {
    const data = Revision.extend({ text: z.string().max(20_000) }).parse(await c.req.json())
    await host.preferences(data.text, data.revision)
    return c.json({ saved: true })
  })
  return app
}
