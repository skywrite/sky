import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { atomicWrite, hash, readOptional, withLock } from '#lib/outbox/files.ts'
import { OutboxError } from '#lib/outbox/types.ts'
import {
  CaptureRequestSchema,
  CaptureResponseSchema,
  type CaptureRequest,
  type CaptureResponse,
} from '#lib/workstreams/captureTypes.ts'
import { WORKSTREAM_COLORS } from '#lib/workstreams/colors.ts'
import { acceptCoordination } from '#lib/workstreams/coordinateWork.ts'
import { DecisionAssumptionSchema, DecisionPolicySchema } from '#lib/workstreams/decisionPolicy.ts'
import {
  ReportDeliverySettingsSchema,
  ReportDeliveryTargetSchema,
  type createReportDelivery,
} from '#lib/workstreams/delivery.ts'
import { workstreamIdentityTime } from '#lib/workstreams/identities.ts'
import { defaultWorkstreamPosition, nextWorkstreamPosition } from '#lib/workstreams/layout.ts'
import { acceptRelationship, RelationshipEditSchema } from '#lib/workstreams/relationships.ts'
import { type WorkstreamStore, workstreamNow } from '#lib/workstreams/store.ts'
import {
  Id,
  ReportingSchema,
  SkySchema,
  WorkstreamError,
  WorkstreamSchema,
  type Workstream,
  type WorkstreamRecord,
  type WorkstreamRun,
} from '#lib/workstreams/types.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

export type WorkstreamsRoutesOptions = {
  store: WorkstreamStore
  now?: () => string
  identityTime?: () => string
  today?: () => string
  draft: (intent: string, sources: Workstream['sources']) => Promise<unknown>
  capture?: (request: CaptureRequest, signal?: AbortSignal) => Promise<CaptureResponse>
  run: (
    id: string,
    request?: string,
    trigger?: 'manual' | 'scheduled' | 'context',
    reportingId?: string,
  ) => Promise<WorkstreamRun>
  setup: () => Promise<unknown>
  automation: () => Promise<{ name: string; status: 'active' | 'paused' } | null>
  communications?: (id: string) => Promise<unknown[]>
  planDay: (id: string, activityId: string, day: string, revision: string) => Promise<WorkstreamRecord>
  outbox?: (id: string, activityId: string, data: Record<string, unknown>) => Promise<unknown>
  sent?: (id: string, activityId: string, data: Record<string, unknown>) => Promise<unknown>
  response?: (id: string, activityId: string, data: Record<string, unknown>) => Promise<unknown>
  reportDelivery?: Pick<ReturnType<typeof createReportDelivery>, 'list' | 'configure' | 'approve' | 'reconcilePending'>
}

const Revision = z.object({ revision: z.string().min(1) })
const PatchFields = WorkstreamSchema.pick({
  title: true,
  intent: true,
  outcome: true,
  understanding: true,
  unknowns: true,
  notes: true,
  state: true,
  parentId: true,
  start: true,
  due: true,
  activities: true,
  sources: true,
  relations: true,
  stakeholders: true,
  metrics: true,
  reporting: true,
}).partial()
// Zod defaults inside optional fields also run on omitted keys. A patch must retain only supplied fields.
const Patch = z.record(z.string(), z.unknown()).transform((input): Partial<Workstream> => {
  const normalized = { ...input }
  for (const key of ['start', 'due', 'parentId']) if (normalized[key] === null) normalized[key] = undefined
  const parsed = PatchFields.parse(normalized)
  return Object.fromEntries(
    Object.keys(input)
      .filter((key) => key in PatchFields.shape)
      .map((key) => [key, parsed[key]]),
  ) as Partial<Workstream>
})
const LayoutItem = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  order: z.number().finite().optional(),
  color: z.enum(WORKSTREAM_COLORS).optional(),
})

export function createWorkstreamRoutes(host: WorkstreamsRoutesOptions): Hono {
  const app = new Hono()
  const now = host.now ?? workstreamNow
  const identityTime = host.identityTime ?? host.now ?? workstreamIdentityTime
  const today = host.today ?? (() => PlainDate.today().ymd)
  const required = async (id: string, revision?: string): Promise<WorkstreamRecord> => {
    const work = await host.store.get(id)
    if (!work) throw new WorkstreamError('The workstream could not be found.', 404)
    if (revision && work.revision !== revision)
      throw new WorkstreamError('The workstream changed. Reload before applying this change.', 409)
    return work
  }
  const history = (work: Workstream, summary: string, kind = 'updated', activityId?: string, operationId?: string) => [
    ...work.history,
    { id: randomUUID(), at: now(), actor: 'human' as const, kind, summary, activityId, operationId },
  ]
  const save = async (
    work: WorkstreamRecord,
    patch: Partial<Workstream>,
    summary: string,
    kind = 'updated',
    operationId?: string,
  ): Promise<WorkstreamRecord> => {
    const activities = patch.activities?.map((activity) => {
      const previous = work.activities.find((item) => item.id === activity.id)
      if (previous?.state === activity.state) return activity
      return {
        ...activity,
        participation: activity.participation.map((entry) =>
          entry.day === today() && !entry.removed ? { ...entry, state: activity.state, reportedAt: now() } : entry,
        ),
      }
    })
    return host.store.put(
      {
        ...work,
        ...patch,
        ...(activities ? { activities } : {}),
        updated: now(),
        history: history(work, summary, kind, undefined, operationId),
      },
      work.revision,
    )
  }
  const layoutFile = path.join(host.store.stateDir, 'layout.json')
  const layout = async () => {
    const text = await readOptional(layoutFile)
    return z.record(z.string(), LayoutItem).parse(text ? JSON.parse(text) : {})
  }
  const createPlaced = (create: () => Promise<WorkstreamRecord>) =>
    withLock(path.join(host.store.stateDir, 'layout.lock'), async () => {
      const positions = await layout()
      const peers = (await host.store.list()).sort(
        (a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id),
      )
      const work = await create()
      if (positions[work.id]) return { work, position: positions[work.id] }
      // Freeze the positions already shown before insertion can change an older card's fallback index.
      const existing = peers.filter((item) => item.id !== work.id)
      existing.forEach((item, index) => {
        positions[item.id] ??= defaultWorkstreamPosition(index)
      })
      const active = existing.filter((item) => item.state !== 'completed' && item.state !== 'canceled')
      const parent = work.parentId ? positions[work.parentId] : undefined
      const position = nextWorkstreamPosition(
        existing.map((item) => positions[item.id]!),
        parent ? [parent] : active.map((item) => positions[item.id]!),
      )
      positions[work.id] = position
      await atomicWrite(layoutFile, JSON.stringify(positions))
      return { work, position }
    })
  const promote = async (work: WorkstreamRecord, activityId: string, title?: string, outcome?: string) => {
    const activity = work.activities.find((item) => item.id === activityId)
    if (!activity) throw new WorkstreamError('This activity could not be found.', 404)
    if (activity.subworkstreamId) return { parent: work, child: await required(activity.subworkstreamId) }
    const operationId = `promote:${work.id}:${activity.id}`
    let child = await host.store.getByCreationOperation(operationId)
    child = (
      await createPlaced(
        async () =>
          child ??
          host.store.create(
            {
              title: title?.trim() || activity.title,
              outcome: outcome?.trim() || activity.outcome || activity.title,
              notes: activity.notes,
              parentId: work.id,
              originActivityId: activity.id,
              history: [
                {
                  id: randomUUID(),
                  at: now(),
                  actor: 'human',
                  kind: 'promoted',
                  summary: `Expanded from an activity in ${work.title}.`,
                  activityId: activity.id,
                },
              ],
            },
            now(),
            { operationId, identityTime: identityTime() },
          ),
      )
    ).work
    const current = await required(work.id, work.revision)
    const parent = await save(
      current,
      {
        activities: current.activities.map((item) =>
          item.id === activity.id ? { ...item, subworkstreamId: child.id } : item,
        ),
      },
      `Expanded “${activity.title}” into a sub-workstream.`,
    )
    return { parent, child }
  }
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site')
      return c.json({ message: 'Open workstreams from the Sky app.' }, 403)
    if (c.req.method !== 'GET' && !c.req.header('Content-Type')?.startsWith('application/json'))
      return c.json({ message: 'Expected a JSON request.' }, 400)
    await next()
  })
  app.onError((error, c) =>
    c.json(
      { message: error.message },
      error instanceof WorkstreamError || error instanceof OutboxError ? error.status : 400,
    ),
  )
  app.get('/status', async (c) =>
    c.json({
      ...(await host.store.report()),
      automation: await host.automation(),
      today: today(),
      layout: await layout(),
    }),
  )
  app.put('/layout', async (c) => {
    const { id, ...patch } = LayoutItem.partial()
      .extend({ id: Id })
      .parse(await c.req.json())
    await required(id)
    await withLock(path.join(host.store.stateDir, 'layout.lock'), async () => {
      const positions = await layout()
      positions[id] = LayoutItem.parse({ ...positions[id], ...patch })
      await atomicWrite(layoutFile, JSON.stringify(positions))
    })
    return c.json({ saved: true })
  })
  app.post('/capture', async (c) => {
    const input = CaptureRequestSchema.parse(await c.req.json())
    if (!host.capture)
      throw new WorkstreamError('Sky’s intake conversation is unavailable. Try again after setup.', 503)
    try {
      return c.json(CaptureResponseSchema.parse(await host.capture(input, c.req.raw.signal)))
    } catch (error) {
      if (error instanceof WorkstreamError) throw error
      if (error instanceof Error && error.name === 'TimeoutError')
        throw new WorkstreamError(
          'Sky took too long to review this. Try again; your intention has not been saved.',
          503,
        )
      if (error instanceof Error && error.name === 'AbortError')
        throw new WorkstreamError('This review was canceled. Your intention has not been saved.', 503)
      throw new WorkstreamError(
        error instanceof z.ZodError
          ? 'Sky returned an incomplete starting point. Try again; your intention has not been saved.'
          : error instanceof Error
            ? error.message
            : 'Sky could not review this intention. Try again.',
        503,
      )
    }
  })
  app.post('/draft', async (c) => {
    const data = z
      .object({ intent: z.string().trim().min(1).max(20000), sources: WorkstreamSchema.shape.sources.default([]) })
      .parse(await c.req.json())
    return c.json(await host.draft(data.intent, data.sources))
  })
  app.post('/create', async (c) => {
    const raw = z.record(z.string(), z.unknown()).parse(await c.req.json())
    const data = { ...Patch.parse(raw), sky: raw.sky === undefined ? undefined : SkySchema.parse(raw.sky) }
    const requestId = raw.requestId === undefined ? undefined : Id.parse(raw.requestId)
    const operationId = requestId ? `capture:${requestId}` : undefined
    const create = async () => {
      const existing = operationId ? await host.store.getByCreationOperation(operationId) : null
      if (existing) {
        const placed = await createPlaced(async () => existing)
        return c.json({ ...placed.work, position: placed.position })
      }
      const title = data.title?.trim() || data.intent?.trim().split('\n')[0]?.slice(0, 160)
      if (!title) throw new WorkstreamError('Describe what you want to accomplish.')
      const placed = await createPlaced(() =>
        host.store.create(
          {
            ...data,
            title,
            proposals: raw.proposals === undefined ? [] : WorkstreamSchema.shape.proposals.parse(raw.proposals),
            history: [
              { id: randomUUID(), at: now(), actor: 'human', kind: 'created', summary: 'Started this workstream.' },
            ],
          },
          now(),
          { operationId, identityTime: identityTime() },
        ),
      )
      let work = placed.work
      if (data.sky && data.sky.mode !== 'off') {
        await host.setup()
        work = await host.store.configureSky(work.id, data.sky, work.revision)
      }
      return c.json({ ...work, position: placed.position }, 201)
    }
    return operationId
      ? withLock(path.join(host.store.stateDir, `creation-${hash(operationId)}.lock`), create)
      : create()
  })
  app.get('/:id', async (c) =>
    c.json({
      workstream: await required(c.req.param('id')),
      runs: await host.store.runs(c.req.param('id')),
      communications: (await host.communications?.(c.req.param('id'))) ?? [],
    }),
  )
  app.put('/:id', async (c) => {
    const data = Revision.extend({ patch: Patch }).parse(await c.req.json())
    const work = await required(c.req.param('id'), data.revision)
    // A promoted activity is a reference. Its independent work belongs to the child.
    for (const activity of data.patch.activities ?? []) {
      const previous = work.activities.find((item) => item.id === activity.id)
      if (previous?.subworkstreamId && activity.state !== previous.state)
        throw new WorkstreamError('Update the sub-workstream to change this work’s status.')
    }
    return c.json(
      await save(
        work,
        data.patch,
        data.patch.state ? `Set workstream to ${data.patch.state}.` : 'Updated the workstream.',
      ),
    )
  })
  app.post('/:id/delete', async (c) => {
    const data = Revision.parse(await c.req.json())
    return c.json(await host.store.delete(c.req.param('id'), data.revision, now()))
  })
  app.post('/:id/restore', async (c) => {
    const data = Revision.parse(await c.req.json())
    return c.json(await host.store.restore(c.req.param('id'), data.revision, now()))
  })
  app.post('/:id/purge', async (c) => {
    const data = Revision.parse(await c.req.json())
    return c.json(await host.store.purge(c.req.param('id'), data.revision))
  })
  app.post('/:id/context', async (c) => {
    const data = Revision.extend({ text: z.string().trim().min(1).max(30000), operationId: Id.optional() }).parse(
      await c.req.json(),
    )
    const replayed = (work: WorkstreamRecord) => {
      if (!data.operationId) return false
      const prior = work.history.find((entry) => entry.kind === 'context' && entry.operationId === data.operationId)
      if (prior && prior.summary !== data.text)
        throw new WorkstreamError('This context update was already saved with different text. Start a new update.', 409)
      return Boolean(prior)
    }
    const work = await required(c.req.param('id'))
    if (replayed(work)) return c.json(work)
    if (work.revision !== data.revision)
      throw new WorkstreamError('The workstream changed. Reload before applying this change.', 409)
    try {
      return c.json(
        await save(
          work,
          { notes: `${work.notes.trimEnd()}\n\n${data.text}\n` },
          data.text,
          'context',
          data.operationId,
        ),
      )
    } catch (error) {
      // A concurrent retry may have saved the same operation after the first read.
      if (data.operationId && error instanceof WorkstreamError && error.status === 409) {
        const current = await required(work.id)
        if (replayed(current)) return c.json(current)
      }
      throw error
    }
  })
  app.post('/:id/sky', async (c) => {
    const data = Revision.extend({ settings: SkySchema }).parse(await c.req.json())
    await required(c.req.param('id'), data.revision)
    if (data.settings.mode !== 'off') await host.setup()
    return c.json(await host.store.configureSky(c.req.param('id'), data.settings, data.revision))
  })
  app.get('/:id/reporting/delivery', async (c) => {
    if (!host.reportDelivery) return c.json({ grants: [], deliveries: [] })
    return c.json(await host.reportDelivery.list(c.req.param('id')))
  })
  app.post('/:id/reporting/:reportingId/delivery', async (c) => {
    if (!host.reportDelivery) throw new WorkstreamError('Report delivery is not available on this host.', 503)
    const data = Revision.extend({ grantRevision: z.string(), settings: ReportDeliverySettingsSchema }).parse(
      await c.req.json(),
    )
    return c.json(
      await host.reportDelivery.configure({
        workstreamId: c.req.param('id'),
        reportingId: c.req.param('reportingId'),
        ...data,
      }),
    )
  })
  app.post('/:id/reporting/:reportingId/prepare', async (c) => {
    const data = Revision.parse(await c.req.json())
    const work = await required(c.req.param('id'), data.revision)
    const reportingId = c.req.param('reportingId')
    if (!work.reporting.some((policy) => policy.id === reportingId))
      throw new WorkstreamError('This reporting audience no longer exists.', 404)
    return c.json(await host.run(work.id, undefined, 'manual', reportingId))
  })
  app.post('/:id/deliveries/:deliveryId/send', async (c) => {
    if (!host.reportDelivery) throw new WorkstreamError('Report delivery is not available on this host.', 503)
    const data = Revision.extend({
      target: ReportDeliveryTargetSchema.optional(),
      attachments: ReportingSchema.shape.attachments,
    }).parse(await c.req.json())
    return c.json(
      await host.reportDelivery.approve({
        workstreamId: c.req.param('id'),
        deliveryId: c.req.param('deliveryId'),
        ...data,
      }),
    )
  })
  app.post('/:id/deliveries/reconcile', async (c) => {
    if (!host.reportDelivery) throw new WorkstreamError('Report delivery is not available on this host.', 503)
    return c.json(await host.reportDelivery.reconcilePending(c.req.param('id')))
  })
  app.post('/:id/run', async (c) => {
    const data = z.object({ request: z.string().max(20000).optional() }).parse(await c.req.json())
    return c.json(await host.run(c.req.param('id'), data.request, 'manual'))
  })
  app.post('/:id/activities/:activityId/decision-policy', async (c) => {
    const data = Revision.extend({
      policy: DecisionPolicySchema,
      assumptions: z.array(DecisionAssumptionSchema).max(30),
    }).parse(await c.req.json())
    const work = await required(c.req.param('id'), data.revision)
    const grant = await host.store.getGrant(work.id)
    const activityId = c.req.param('activityId')
    const settings = SkySchema.parse({
      ...work.sky,
      ...grant,
      decisionPolicies: { ...grant.decisionPolicies, [activityId]: data.policy },
    })
    if (settings.mode !== 'off') await host.setup()
    return c.json(
      await host.store.configureSky(work.id, settings, data.revision, { activityId, assumptions: data.assumptions }),
    )
  })
  app.get('/:id/artifacts/:artifactId', async (c) =>
    c.json(await host.store.readArtifact(c.req.param('id'), c.req.param('artifactId'))),
  )
  app.post('/:id/activities/:activityId/today', async (c) => {
    const data = Revision.extend({ day: z.string().optional() }).parse(await c.req.json())
    return c.json(await host.planDay(c.req.param('id'), c.req.param('activityId'), data.day ?? today(), data.revision))
  })
  app.post('/:id/activities/:activityId/resolve', async (c) => {
    const data = Revision.extend({ result: z.string().trim().min(1).max(20000) }).parse(await c.req.json())
    const work = await required(c.req.param('id'), data.revision)
    const activity = work.activities.find((item) => item.id === c.req.param('activityId'))
    if (!activity) throw new WorkstreamError('This activity could not be found.', 404)
    if (activity.subworkstreamId) throw new WorkstreamError('Open the sub-workstream to record its result.')
    return c.json(
      await save(
        work,
        {
          activities: work.activities.map((item) =>
            item.id === activity.id ? { ...item, state: 'done' as const, result: data.result, waitingFor: '' } : item,
          ),
        },
        `Recorded the result for “${activity.title}”: ${data.result}`,
      ),
    )
  })
  app.post('/:id/activities/:activityId/promote', async (c) => {
    const data = Revision.extend({
      title: z.string().max(200).optional(),
      outcome: z.string().max(20000).optional(),
    }).parse(await c.req.json())
    return c.json(
      await promote(
        await required(c.req.param('id'), data.revision),
        c.req.param('activityId'),
        data.title,
        data.outcome,
      ),
    )
  })
  app.post('/:id/proposals/:proposalId/accept', async (c) => {
    const data = Revision.extend({ relation: RelationshipEditSchema.optional() }).parse(await c.req.json())
    let work = await required(c.req.param('id'), data.revision)
    const proposal = work.proposals.find((item) => item.id === c.req.param('proposalId'))
    if (!proposal) throw new WorkstreamError('This suggestion is no longer available.', 404)
    if (data.relation && proposal.kind !== 'relation')
      throw new WorkstreamError('Only a relationship suggestion can be accepted as a relationship.')
    const relationPatch = proposal.kind === 'relation' ? acceptRelationship(work, proposal, data.relation) : {}
    let created: WorkstreamRecord | undefined
    if (proposal.kind === 'subworkstream') {
      const operationId = `proposal:${work.id}:${proposal.id}`
      created = (
        await createPlaced(
          async () =>
            (await host.store.getByCreationOperation(operationId)) ??
            host.store.create({ title: proposal.title, outcome: proposal.outcome ?? '', parentId: work.id }, now(), {
              operationId,
              identityTime: identityTime(),
            }),
        )
      ).work
    }
    work = await host.store.put(
      {
        ...work,
        proposals: work.proposals.filter((item) => item.id !== proposal.id),
        ...(proposal.kind === 'coordination' && proposal.coordination
          ? acceptCoordination(work, proposal.coordination)
          : {}),
        ...(proposal.kind === 'outcome' ? { outcome: proposal.outcome ?? proposal.title } : {}),
        ...(proposal.kind === 'suggestion' ? { notes: `${work.notes.trimEnd()}\n\n${proposal.title}\n` } : {}),
        ...relationPatch,
        updated: now(),
        history: history(work, `Accepted Sky’s suggestion: ${proposal.title}`),
      },
      work.revision,
    )
    return c.json({ workstream: work, created })
  })
  app.post('/:id/proposals/:proposalId/dismiss', async (c) => {
    const data = Revision.parse(await c.req.json())
    const work = await required(c.req.param('id'), data.revision)
    return c.json(
      await host.store.put(
        {
          ...work,
          proposals: work.proposals.filter((item) => item.id !== c.req.param('proposalId')),
          updated: now(),
          history: history(work, 'Dismissed a suggestion from Sky.'),
        },
        work.revision,
      ),
    )
  })
  for (const [endpoint, operation] of [
    ['outbox', host.outbox],
    ['sent', host.sent],
    ['response', host.response],
  ] as const) {
    app.post(`/:id/activities/:activityId/${endpoint}`, async (c) => {
      if (!operation) throw new WorkstreamError('This communication operation is not available.', 503)
      const data = z.record(z.string(), z.unknown()).parse(await c.req.json())
      return c.json(await operation(c.req.param('id'), c.req.param('activityId'), data))
    })
  }
  return app
}
