import { Hono } from 'hono'
import { z } from 'zod'
import { ScanRangeSchema, type SavedScanRange, type ScanRange } from '#lib/outbox/range.ts'
import { OutboxError, type OutboxRecord, type ScanProgress, type ScanReport } from '#lib/outbox/types.ts'
import { hold } from '../../activity.ts'

export type OutboxReport = {
  items: OutboxRecord[]
  preferences: { text: string; revision: string }
  automation: { name: string; status: 'active' | 'paused' } | null
  lastScan: (ScanReport & { at: string }) | null
  check?: OutboxCheck
  followupsRunning?: boolean
  search?: SavedScanRange
  today?: string
  modelLabel?: string
}

export type OutboxScanResult = {
  outcome: ScanReport['outcome']
  message?: string
  running?: boolean
  severity?: 'info' | 'error'
}

export type OutboxCheck = {
  running: boolean
  progress: ScanProgress | null
  result: OutboxScanResult | null
}

export type OutboxRoutesOptions = {
  report: () => Promise<OutboxReport>
  setup: () => Promise<unknown>
  scan: (selection?: { range: ScanRange; revision: string }) => Promise<OutboxScanResult>
  save: (id: string, revision: string, draft: string) => Promise<OutboxRecord>
  dismiss: (id: string, revision: string) => Promise<OutboxRecord>
  approve: (id: string, revision: string, draft: string, reviewedChanges: boolean) => Promise<OutboxRecord>
  preferences: (text: string, revision: string) => Promise<void>
  compose?: (
    id: string,
    revision: string,
    draft: string,
    instruction: string,
    reviewedChanges: boolean,
  ) => Promise<OutboxRecord>
  reportSent?: (id: string, revision: string, evidence: string) => Promise<OutboxRecord>
  get?: (id: string) => Promise<OutboxRecord | null>
  retryFollowups?: (id: string, revision: string) => Promise<OutboxRecord>
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
  app.get('/item/:id', async (c) => {
    const item = await host.get?.(c.req.param('id'))
    if (!item) return c.json({ message: 'This Outbox item is no longer available.' }, 404)
    return c.json(item)
  })
  app.post('/setup', async (c) => c.json(await host.setup()))
  app.post('/scan', async (c) => {
    // The request still belongs to this process until the detached worker is registered.
    const release = hold('outbox check startup')
    try {
      const input = z
        .union([z.object({ range: ScanRangeSchema, revision: z.string().min(1) }).strict(), z.object({}).strict()])
        .parse(await c.req.json())
      const result = await host.scan(input.range ? { range: input.range, revision: input.revision } : undefined)
      return c.json(result, result.running ? 202 : 200)
    } finally {
      release()
    }
  })
  app.put('/item/:id', async (c) => {
    const data = Draft.parse(await c.req.json())
    return c.json(await host.save(c.req.param('id'), data.revision, data.draft))
  })
  app.post('/item/:id/approve', async (c) => {
    const data = Draft.extend({ reviewedChanges: z.boolean().default(false) }).parse(await c.req.json())
    return c.json(await host.approve(c.req.param('id'), data.revision, data.draft, data.reviewedChanges))
  })
  app.post('/item/:id/compose', async (c) => {
    if (!host.compose) return c.json({ message: 'Reply writing is unavailable.' }, 503)
    const release = hold('outbox revision startup')
    try {
      const data = Draft.extend({
        instruction: z.string().trim().min(1).max(4000),
        reviewedChanges: z.boolean().default(false),
      }).parse(await c.req.json())
      const item = await host.compose(
        c.req.param('id'),
        data.revision,
        data.draft,
        data.instruction,
        data.reviewedChanges,
      )
      return c.json(item, item.composition?.status === 'running' ? 202 : 200)
    } finally {
      release()
    }
  })
  app.post('/item/:id/followups', async (c) => {
    if (!host.retryFollowups) return c.json({ message: 'Follow-up drafting is unavailable.' }, 503)
    const data = Revision.parse(await c.req.json())
    return c.json(await host.retryFollowups(c.req.param('id'), data.revision))
  })
  app.post('/item/:id/dismiss', async (c) => {
    const data = Revision.parse(await c.req.json())
    return c.json(await host.dismiss(c.req.param('id'), data.revision))
  })
  app.post('/item/:id/sent', async (c) => {
    if (!host.reportSent) return c.json({ message: 'Sent-message reports are unavailable.' }, 503)
    const data = Revision.extend({ evidence: z.string().trim().min(1).max(5000) }).parse(await c.req.json())
    return c.json(await host.reportSent(c.req.param('id'), data.revision, data.evidence))
  })
  app.put('/preferences', async (c) => {
    const data = Revision.extend({ text: z.string().max(20_000) }).parse(await c.req.json())
    await host.preferences(data.text, data.revision)
    return c.json({ saved: true })
  })
  return app
}
