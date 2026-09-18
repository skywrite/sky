import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import { assert, test } from '#test'
import { createReportDelivery } from './delivery.ts'
import { createWorkstreamOutbox } from './outbox.ts'
import { runWorkstream } from './runner.ts'
import { WorkstreamStore } from './store.ts'
import { ReportingSchema, SkySchema } from './types.ts'

async function fixture(
  run: (input: {
    store: WorkstreamStore
    delivery: ReturnType<typeof createReportDelivery>
    id: string
    clock: (at: string) => void
    sent: string[]
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-report-execution-'))
  try {
    let now = '2025-03-15 09:00'
    const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
    const outboxStore = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'outbox-state'))
    const sources = new SavedMessages(root, { Slack: [], Email: [] })
    const outbox = createWorkstreamOutbox({ workstreams: store, store: outboxStore, sources, now: () => now })
    const sent: string[] = []
    const delivery = createReportDelivery({
      store,
      outbox,
      outboxStore,
      now: () => now,
      transport: {
        send: async (record, authorize) => {
          await authorize()
          sent.push(record.id)
          return { medium: 'slack', id: record.id, url: `https://example.com/sent/${record.id}` }
        },
      },
    })
    await writeFile(path.join(root, 'update.md'), 'The invited pilot scope has been prepared.')
    let work = await store.create(
      {
        title: 'Atlas pilot',
        sources: [{ id: 'update', path: 'update.md', label: 'Pilot progress', sensitive: false }],
        reporting: [
          ReportingSchema.parse({
            id: 'reviewers',
            audience: 'Pilot reviewers',
            medium: 'slack',
            permittedSourceIds: ['update'],
            cadenceDays: 7,
          }),
        ],
      },
      now,
    )
    work = await store.configureSky(work.id, SkySchema.parse({ mode: 'drive' }), work.revision)
    const grant = await delivery.grant(work.id, 'reviewers')
    await delivery.configure({
      workstreamId: work.id,
      reportingId: 'reviewers',
      revision: work.revision,
      grantRevision: grant.revision,
      settings: {
        mode: 'send',
        target: { medium: 'slack', workspace: 'https://example.slack.com', channelId: 'C01234567' },
        maxPerDay: 1,
      },
    })
    await run({
      store,
      delivery,
      id: work.id,
      sent,
      clock: (at) => {
        now = at
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('scheduled reporting delivers recurring audience updates and preserves provider receipts', async () => {
  await fixture(async ({ store, delivery, id, sent, clock }) => {
    let reports = 0
    const report = async () => {
      reports++
      return { title: 'Pilot update', body: 'The invited pilot scope has been prepared.', missingInputs: [] }
    }
    const first = await runWorkstream({
      store,
      id,
      now: '2025-03-15 09:00',
      trigger: 'scheduled',
      reportDelivery: delivery,
      report,
    })
    clock('2025-03-15 09:05')
    const second = await runWorkstream({
      store,
      id,
      now: '2025-03-15 09:05',
      trigger: 'scheduled',
      reportDelivery: delivery,
      report,
    })
    clock('2025-03-22 09:00')
    const third = await runWorkstream({
      store,
      id,
      now: '2025-03-22 09:00',
      trigger: 'scheduled',
      reportDelivery: delivery,
      report,
    })
    const records = (await delivery.list(id)).deliveries
    assert({
      given: 'a reporting cadence with explicit destination and standing delivery authority',
      should: 'deliver once per due report and retain actual provider receipts',
      actual: [
        first.status,
        second.status,
        third.status,
        reports,
        sent.length,
        new Set(sent).size,
        records.map((record) => record.status),
      ],
      expected: ['completed', 'nothing', 'completed', 2, 2, 2, ['sent', 'sent']],
    })
  })
})

test('a persisted report resumes delivery after a gap between artifact commit and dispatch', async () => {
  await fixture(async ({ store, delivery, id, sent, clock }) => {
    let reports = 0
    const report = async () => {
      reports++
      return { title: 'Pilot update', body: 'The invited pilot scope has been prepared.', missingInputs: [] }
    }
    const interrupted = {
      ...delivery,
      dispatch: async () => {
        throw new Error('Simulated stop before the delivery ledger was created.')
      },
    }
    await runWorkstream({
      store,
      id,
      now: '2025-03-15 09:00',
      trigger: 'scheduled',
      reportDelivery: interrupted,
      report,
    })
    clock('2025-03-15 09:05')
    const after = await runWorkstream({
      store,
      id,
      now: '2025-03-15 09:05',
      trigger: 'scheduled',
      reportDelivery: delivery,
      report,
      propose: async () => {
        throw new Error('Recovery must use the saved report without another model call.')
      },
    })
    const records = (await delivery.list(id)).deliveries
    assert({
      given: 'a report committed before interruption and the next scheduled wake-up',
      should: 'reuse the prepared artifact and deliver that intent once',
      actual: [reports, sent.length, records[0]?.status, (await store.get(id))!.artifacts.length, after.status],
      expected: [1, 1, 'sent', 1, 'completed'],
    })
  })
})

test('new recording and presentation links let the owner regenerate and deliver a previously incomplete report', async () => {
  await fixture(async ({ store, delivery, id, sent, clock }) => {
    let work = (await store.get(id))!
    work = await store.put(
      { ...work, reporting: work.reporting.map((policy) => ({ ...policy, artifacts: ['Recording', 'Presentation'] })) },
      work.revision,
    )
    const grant = await delivery.grant(id, 'reviewers')
    await delivery.configure({
      workstreamId: id,
      reportingId: 'reviewers',
      revision: work.revision,
      grantRevision: grant.revision,
      settings: { mode: 'send', target: grant.target, maxPerDay: 1 },
    })
    await runWorkstream({
      store,
      id,
      now: '2025-03-15 09:00',
      trigger: 'scheduled',
      reportDelivery: delivery,
      report: async () => ({
        title: 'Pilot update',
        body: 'The pilot scope is ready.',
        missingInputs: ['The recording and presentation links are still needed.'],
      }),
    })
    const first = (await delivery.list(id)).deliveries[0]!
    work = (await store.get(id))!
    const nextDue = work.reporting[0]!.nextDueAt
    work = await store.put(
      {
        ...work,
        reporting: work.reporting.map((policy) => ({
          ...policy,
          attachments: [
            { name: 'Recording', url: 'https://example.com/recording' },
            { name: 'Presentation', url: 'https://example.com/presentation' },
          ],
        })),
      },
      work.revision,
    )
    clock('2025-03-15 09:20')
    const refreshed = await runWorkstream({
      store,
      id,
      now: '2025-03-15 09:20',
      reportingId: 'reviewers',
      reportDelivery: delivery,
      report: async (context) => {
        const policy = context.reporting as { attachments: unknown[] }
        assert({
          given: 'new supplied artifact links',
          should: 'reassess the report using both actual links',
          actual: policy.attachments.length,
          expected: 2,
        })
        return {
          title: 'Complete pilot update',
          body: 'The pilot scope is ready. The recording and presentation are included.',
          missingInputs: [],
        }
      },
    })
    const fresh = (await delivery.list(id)).deliveries.find((record) => record.artifactId === refreshed.artifactIds[0])!
    assert({
      given: 'a blocked report refreshed after the actual missing inputs arrive',
      should: 'deliver the new complete report without bypassing factual checks or shifting its cadence',
      actual: [
        first.status,
        first.blockers.some((reason) => reason.startsWith('Missing input:')),
        fresh.blockers,
        fresh.status,
        sent.length,
        (await store.get(id))!.reporting[0]!.nextDueAt === nextDue,
      ],
      expected: ['review', true, [], 'sent', 1, true],
    })
  })
})
