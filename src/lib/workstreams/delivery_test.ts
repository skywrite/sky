import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { hash } from '#lib/outbox/files.ts'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import { assert, test } from '#test'
import {
  createReportDelivery,
  ReportSendUnknownError,
  type ReportDeliveryRecord,
  type ReportTransport,
} from './delivery.ts'
import { createWorkstreamOutbox } from './outbox.ts'
import { WorkstreamStore } from './store.ts'
import { ReportingSchema, SkySchema } from './types.ts'

const NOW = '2025-03-15 12:00'
const TARGET = { medium: 'slack' as const, workspace: 'https://atlas.slack.com', channelId: 'C1234567' }
const RECEIPT = {
  medium: 'slack' as const,
  id: 'message-1',
  url: 'https://atlas.slack.com/archives/C1234567/p1742040000000000',
}
const EMAIL_TARGET = { medium: 'email' as const, account: 'owner@example.com', to: ['jane@example.com'] }
const EMAIL_RECEIPT = {
  medium: 'email' as const,
  id: 'email-message-1',
  url: 'https://mail.google.com/mail/u/owner@example.com/#sent/thread-1',
}

async function fixture(
  transport?: ReportTransport,
  requiredArtifacts: string[] = [],
  medium: 'slack' | 'email' = 'slack',
) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-report-delivery-'))
  let currentTime = NOW
  const state = path.join(root, 'state', 'workstreams')
  const content = path.join(state, 'content')
  const store = new WorkstreamStore(path.join(content, 'workstreams'), state, root, () => NOW.slice(0, 10), content)
  const outboxStore = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'state', 'outbox'))
  const sources = new SavedMessages(root, { Slack: [], Email: [] })
  const outbox = createWorkstreamOutbox({ store: outboxStore, sources, workstreams: store, now: () => currentTime })
  let sends = 0
  let sendCalls = 0
  const sentBodies: string[] = []
  const delivery = createReportDelivery({
    store,
    outbox,
    outboxStore,
    now: () => currentTime,
    transport: transport ?? {
      send: async (record, authorize) => {
        sendCalls++
        await authorize()
        sends++
        sentBodies.push(record.body)
        return medium === 'email' ? EMAIL_RECEIPT : RECEIPT
      },
    },
  })
  await writeFile(path.join(root, 'public.md'), 'The launch brief is awaiting approval.')
  let work = await store.create(
    {
      title: 'Atlas launch',
      sources: [{ id: 'public', path: 'public.md', label: 'Public launch brief', sensitive: false }],
      reporting: [
        ReportingSchema.parse({
          id: 'board',
          audience: 'Advisory board',
          medium,
          destination: medium === 'email' ? 'jane@example.com' : '#advisory-board',
          artifacts: requiredArtifacts,
          permittedSourceIds: ['public'],
        }),
      ],
    },
    NOW,
  )
  const artifact = {
    id: 'report-1',
    title: 'Atlas update',
    path: path.join(path.dirname(work.path), 'artifacts', 'report-1.md'),
    reportingId: 'board',
    kind: 'report' as const,
    created: NOW,
  }
  await store.writeArtifact(work.id, artifact, 'The launch brief is awaiting approval.\n')
  work = await store.put({ ...work, artifacts: [artifact] }, work.revision)
  const enable = async () => {
    let current = (await store.get(work.id))!
    current = await store.configureSky(work.id, SkySchema.parse({ mode: 'assist' }), current.revision)
    const permission = await delivery.configure({
      workstreamId: work.id,
      reportingId: 'board',
      revision: current.revision,
      grantRevision: (await delivery.grant(work.id, 'board')).revision,
      settings: { mode: 'send', target: medium === 'email' ? EMAIL_TARGET : TARGET, maxPerDay: 1 },
    })
    return { work: current, permission }
  }
  const dispatch = async (extra: Partial<Parameters<typeof delivery.dispatch>[0]> = {}) => {
    const current = (await store.get(work.id))!
    return delivery.dispatch({
      workstreamId: work.id,
      reportingId: 'board',
      artifactId: artifact.id,
      revision: current.revision,
      expectedGrantRevision: (await delivery.grant(work.id, 'board')).revision,
      expectedSourceVersions: await delivery.sourceVersions(current, current.reporting[0]),
      ...extra,
    })
  }
  return {
    root,
    store,
    outboxStore,
    outbox,
    delivery,
    work,
    artifact,
    dispatch,
    enable,
    sends: () => sends,
    sendCalls: () => sendCalls,
    sentBodies,
    clock: (at: string) => {
      currentTime = at
    },
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

test('report source checks follow linked workstream content in state without weakening notebook evidence', async () => {
  const f = await fixture()
  try {
    const peer = await f.store.create({ title: 'Pilot scope', notes: 'Original scope.' }, NOW)
    const work = await f.store.put(
      {
        ...f.work,
        sources: [...f.work.sources, { id: 'scope', path: peer.path, label: 'Scope', sensitive: false }],
        reporting: f.work.reporting.map((policy) => ({ ...policy, permittedSourceIds: ['public', 'scope'] })),
      },
      f.work.revision,
    )
    const before = await f.delivery.sourceVersions(work, work.reporting[0])
    await f.store.put({ ...peer, notes: 'Revised scope.' }, peer.revision)
    const after = await f.delivery.sourceVersions(work, work.reporting[0])
    const report = await f.dispatch()
    const ledger = path.join(f.store.contentRoot, path.dirname(work.path), 'deliveries', `${report.id}.md`)
    assert({
      given: 'a report cites notebook evidence and another workstream after owned content moves to state',
      should: 'hash both authoritative sources, notice a changed workstream and persist its delivery in state',
      actual: [
        before.public === after.public,
        before.scope !== after.scope,
        (await readFile(ledger, 'utf8')).includes(report.id),
        f.sends(),
      ],
      expected: [true, true, true, 0],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

async function rejectedMessage(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

test('Gmail reports remain local review drafts and cannot receive send grants or manual send approval', async () => {
  const f = await fixture(undefined, [], 'email')
  try {
    const original = await f.delivery.grant(f.work.id, 'board')
    const refusedGrant = await rejectedMessage(() => f.enable())
    const unchanged = await f.delivery.grant(f.work.id, 'board')
    const prepared = await f.dispatch()
    const item = (await f.outboxStore.get(prepared.outboxId!))!
    await f.outboxStore.put({ ...item, draft: 'The edited Atlas update.', edited: true }, item.revision)
    const reviewed = (await f.delivery.get(f.work.id, prepared.id))!
    const refusedApproval = await rejectedMessage(() =>
      f.delivery.approve({
        workstreamId: f.work.id,
        deliveryId: reviewed.id,
        revision: reviewed.revision,
        target: EMAIL_TARGET,
      }),
    )
    const attemptedMediumChange = await rejectedMessage(() =>
      f.delivery.approve({
        workstreamId: f.work.id,
        deliveryId: reviewed.id,
        revision: reviewed.revision,
        target: TARGET,
      }),
    )
    await f.delivery.reconcilePending(f.work.id)
    const current = (await f.delivery.get(f.work.id, prepared.id))!
    const currentItem = (await f.outboxStore.get(current.outboxId!))!
    assert({
      given: 'an email reporting policy, requested send authority, and explicit approval of an edited draft',
      should: 'reject both send paths before transport and retain the local wording for review',
      actual: {
        refusedGrant: refusedGrant.includes('draft-only'),
        unchangedAuthority: original.revision === unchanged.revision,
        mode: unchanged.mode,
        refusedApproval: refusedApproval.includes('draft-only'),
        attemptedMediumChange: attemptedMediumChange.includes('draft-only'),
        status: current.status,
        draft: currentItem.draft,
        outboxStatus: currentItem.status,
        native: Boolean(currentItem.native),
        sendCalls: f.sendCalls(),
        approval: Boolean(current.approval),
      },
      expected: {
        refusedGrant: true,
        unchangedAuthority: true,
        mode: 'review',
        refusedApproval: true,
        attemptedMediumChange: true,
        status: 'review',
        draft: 'The edited Atlas update.',
        outboxStatus: 'needs_review',
        native: false,
        sendCalls: 0,
        approval: false,
      },
    })
  } finally {
    await f.clean()
  }
})

test('legacy Gmail send grants cannot dispatch or revive queued sends during reconciliation', async () => {
  const f = await fixture(undefined, [], 'email')
  try {
    let work = (await f.store.get(f.work.id))!
    work = await f.store.configureSky(work.id, SkySchema.parse({ mode: 'assist' }), work.revision)
    await f.delivery.configure({
      workstreamId: work.id,
      reportingId: 'board',
      revision: work.revision,
      grantRevision: (await f.delivery.grant(work.id, 'board')).revision,
      settings: { mode: 'review', target: EMAIL_TARGET, maxPerDay: 1 },
    })
    const grantFile = path.join(f.store.stateDir, 'permissions', `report-${work.id}-board.json`)
    const saved = JSON.parse(await readFile(grantFile, 'utf8')) as Record<string, unknown>
    await writeFile(grantFile, JSON.stringify({ ...saved, mode: 'send' }))
    const effective = await f.delivery.grant(work.id, 'board')
    const prepared = await f.dispatch()
    const file = path.join(f.store.contentRoot, path.dirname(work.path), 'deliveries', `${prepared.id}.md`)
    const recovered: unknown[] = []
    for (const status of ['review', 'failed']) {
      // Recover a legacy ledger whose local Outbox link was never saved.
      const text = (await readFile(file, 'utf8'))
        .replace(/^status: review$/m, `status: ${status}`)
        .replace(/^outboxId:.*\n/m, '')
      await writeFile(file, text)
      const pending = await f.delivery.reconcilePending(work.id)
      const record = pending.find((entry) => entry.id === prepared.id)!
      recovered.push([record.status, Boolean(record.outboxId), record.error?.includes('draft-only')])
    }
    const repeated = await f.dispatch()
    const refusal = await rejectedMessage(() =>
      f.delivery.approve({ workstreamId: work.id, deliveryId: repeated.id, revision: repeated.revision }),
    )
    assert({
      given: 'a persisted send grant from before Gmail became draft-only, plus queued review and failed records',
      should: 'read the grant as review, recover local drafts, and never call the sending transport',
      actual: {
        savedMode: JSON.parse(await readFile(grantFile, 'utf8')).mode,
        effectiveMode: effective.mode,
        scopeCurrent: effective.scopeCurrent,
        initiallyPrepared: [prepared.status, Boolean(prepared.outboxId)],
        recovered,
        sameDelivery: repeated.id === prepared.id,
        refusedApproval: refusal.includes('draft-only'),
        sendCalls: f.sendCalls(),
      },
      expected: {
        savedMode: 'send',
        effectiveMode: 'review',
        scopeCurrent: true,
        initiallyPrepared: ['review', true],
        recovered: [
          ['review', true, true],
          ['review', true, true],
        ],
        sameDelivery: true,
        refusedApproval: true,
        sendCalls: 0,
      },
    })
  } finally {
    await f.clean()
  }
})

test('historical uncertain Gmail sends reconcile read-only and retain their actual receipts', async () => {
  let sendCalls = 0
  let found = false
  let reconciliations = 0
  const f = await fixture(
    {
      send: async () => {
        sendCalls++
        return EMAIL_RECEIPT
      },
      reconcile: async () => {
        reconciliations++
        return found ? EMAIL_RECEIPT : null
      },
    },
    [],
    'email',
  )
  try {
    const work = (await f.store.get(f.work.id))!
    await f.delivery.configure({
      workstreamId: work.id,
      reportingId: 'board',
      revision: work.revision,
      grantRevision: (await f.delivery.grant(work.id, 'board')).revision,
      settings: { mode: 'review', target: EMAIL_TARGET, maxPerDay: 1 },
    })
    const prepared = await f.dispatch()
    const file = path.join(f.store.contentRoot, path.dirname(work.path), 'deliveries', `${prepared.id}.md`)
    await writeFile(file, (await readFile(file, 'utf8')).replace('status: review', 'status: sending'))
    const uncertain = (await f.delivery.reconcilePending(work.id))[0]
    found = true
    const observed = (await f.delivery.reconcilePending(work.id))[0]
    await f.delivery.reconcilePending(work.id)
    const repeated = await f.dispatch()
    const current = (await f.store.get(work.id))!
    assert({
      given: 'an interrupted historical Gmail send that is later found through provider reads',
      should: 'preserve uncertainty, acknowledge the real receipt once, and never repeat the external write',
      actual: [
        uncertain.status,
        observed.status,
        observed.receipt,
        repeated.status,
        repeated.receipt,
        reconciliations,
        sendCalls,
        current.history.filter((entry) => entry.kind === 'report_sent').length,
      ],
      expected: ['unknown', 'sent', EMAIL_RECEIPT, 'sent', EMAIL_RECEIPT, 2, 0, 1],
    })
  } finally {
    await f.clean()
  }
})

test('reports default to the existing Outbox and explicit approval sends the actual edited wording once', async () => {
  const f = await fixture()
  try {
    const prepared = await f.dispatch()
    const repeated = await f.dispatch()
    const item = (await f.outboxStore.get(prepared.outboxId!))!
    await f.outboxStore.put(
      { ...item, draft: 'The launch brief is ready for your approval, Jane.', edited: true },
      item.revision,
    )
    const reviewed = (await f.delivery.get(f.work.id, prepared.id))!
    let stale = false
    try {
      await f.delivery.approve({
        workstreamId: f.work.id,
        deliveryId: prepared.id,
        revision: prepared.revision,
        target: TARGET,
      })
    } catch {
      stale = true
    }
    const sent = await f.delivery.approve({
      workstreamId: f.work.id,
      deliveryId: reviewed.id,
      revision: reviewed.revision,
      target: TARGET,
    })
    await f.dispatch()
    await f.delivery.reconcilePending(f.work.id)
    assert({
      given: 'a draft prepared twice, edited in Outbox, then explicitly approved',
      should: 'preserve one review item, reject stale wording and deliver exactly the reviewed text once',
      actual: [
        prepared.status,
        repeated.id === prepared.id,
        stale,
        sent.status,
        f.sends(),
        f.sentBodies[0],
        (await f.outboxStore.get(prepared.outboxId!))!.status,
      ],
      expected: ['review', true, true, 'sent', 1, 'The launch brief is ready for your approval, Jane.', 'dismissed'],
    })
  } finally {
    await f.clean()
  }
})

test('standing report delivery binds exact policy scope and records a provider receipt', async () => {
  const f = await fixture()
  try {
    await f.enable()
    const sent = await f.dispatch()
    const again = await f.dispatch()
    const current = (await f.store.get(f.work.id))!
    const changed = await f.store.put(
      { ...current, reporting: current.reporting.map((policy) => ({ ...policy, audience: 'A different audience' })) },
      current.revision,
    )
    const permission = await f.delivery.grant(changed.id, 'board')
    assert({
      given: 'explicit standing authority and an audience change after successful delivery',
      should: 'send once, preserve its receipt and identify the old grant as out of scope',
      actual: [
        sent.status,
        sent.receipt?.id,
        again.id === sent.id,
        f.sends(),
        permission.scopeCurrent,
        current.history.filter((entry) => entry.kind === 'report_sent').length,
      ],
      expected: ['sent', RECEIPT.id, true, 1, false, 1],
    })
  } finally {
    await f.clean()
  }
})

test('required artifacts and missing factual inputs prevent automatic report delivery', async () => {
  const f = await fixture(undefined, ['Loom', 'Presentation'])
  try {
    await f.enable()
    const report = await f.dispatch({
      attachments: [{ name: 'Presentation', url: 'https://example.com/slides' }],
      missingInputs: ['Confirm the forecast'],
    })
    assert({
      given: 'a reporting grant but missing required artifacts and a missing factual input',
      should: 'keep the report in review with explicit blockers',
      actual: [
        report.status,
        f.sends(),
        report.blockers.some((blocker) => blocker.includes('Loom')),
        report.blockers.some((blocker) => blocker.includes('forecast')),
        Boolean(report.outboxId),
      ],
      expected: ['review', 0, true, true, true],
    })
  } finally {
    await f.clean()
  }
})

test('ambiguous delivery never retries and reconciliation records an observed sent receipt', async () => {
  let posts = 0
  let found = false
  const f = await fixture({
    send: async (_record, authorize) => {
      await authorize()
      posts++
      throw new ReportSendUnknownError('Response lost after posting')
    },
    reconcile: async () => (found ? RECEIPT : null),
  })
  try {
    await f.enable()
    const unknown = await f.dispatch()
    await f.dispatch()
    await f.delivery.reconcilePending(f.work.id)
    let refused = false
    try {
      await f.delivery.approve({ workstreamId: f.work.id, deliveryId: unknown.id, revision: unknown.revision })
    } catch {
      refused = true
    }
    found = true
    const reconciled = await f.delivery.reconcilePending(f.work.id)
    assert({
      given: 'a possibly accepted send with no receipt, later located in the provider',
      should: 'never post again and reconcile the observed message',
      actual: [unknown.status, refused, posts, reconciled[0].status, reconciled[0].receipt?.id],
      expected: ['unknown', true, 1, 'sent', RECEIPT.id],
    })
  } finally {
    await f.clean()
  }
})

test('revocation during provider preparation prevents sending and definite refusal can be explicitly retried', async () => {
  let before: ((record: ReportDeliveryRecord) => Promise<void>) | undefined
  let posts = 0
  const f = await fixture({
    send: async (record, authorize) => {
      if (before) await before(record)
      await authorize()
      posts++
      return RECEIPT
    },
  })
  try {
    await f.enable()
    before = async () => {
      const work = (await f.store.get(f.work.id))!
      const permission = await f.delivery.grant(work.id, 'board')
      await f.delivery.configure({
        workstreamId: work.id,
        reportingId: 'board',
        revision: work.revision,
        grantRevision: permission.revision,
        settings: { mode: 'review', target: TARGET, maxPerDay: 1 },
      })
    }
    const failed = await f.dispatch()
    before = undefined
    const retried = await f.delivery.approve({
      workstreamId: f.work.id,
      deliveryId: failed.id,
      revision: failed.revision,
    })
    assert({
      given: 'delivery authority revoked immediately before the provider write, then explicit one-report approval',
      should: 'refuse the standing send and allow the exact reviewed manual retry',
      actual: [failed.status, retried.status, posts],
      expected: ['failed', 'sent', 1],
    })
  } finally {
    await f.clean()
  }
})

test('a changed report source and a changed artifact never send a stale report', async () => {
  const f = await fixture()
  try {
    await writeFile(path.join(f.root, 'brief.md'), 'Original scope')
    let work = (await f.store.get(f.work.id))!
    work = await f.store.put(
      {
        ...work,
        sources: [{ id: 'brief', path: 'brief.md', label: 'Brief', sensitive: false }],
        reporting: work.reporting.map((policy) => ({ ...policy, permittedSourceIds: ['brief'] })),
      },
      work.revision,
    )
    await f.enable()
    await writeFile(path.join(f.root, 'brief.md'), 'Changed scope')
    const prepared = await f.dispatch({ expectedSourceVersions: { brief: hash('Original scope') } })
    const file = path.join(f.store.contentRoot, f.artifact.path)
    await writeFile(file, (await readFile(file, 'utf8')).replace('awaiting approval', 'already approved'))
    const attempt = await f.delivery.approve({
      workstreamId: f.work.id,
      deliveryId: prepared.id,
      revision: prepared.revision,
      target: TARGET,
    })
    assert({
      given: 'source drift during preparation followed by a manual artifact edit',
      should: 'retain the blockers and refuse stale delivery',
      actual: [
        prepared.status,
        prepared.blockers.some((value) => value.includes('source snapshot')),
        attempt.status,
        f.sends(),
      ],
      expected: ['review', true, 'review', 0],
    })
  } finally {
    await f.clean()
  }
})

test('an interrupted sending ledger is reconciled without repeating the external write', async () => {
  let posts = 0
  let found = false
  const f = await fixture({
    send: async (_record, authorize) => {
      await authorize()
      posts++
      return RECEIPT
    },
    reconcile: async () => (found ? RECEIPT : null),
  })
  try {
    const current = (await f.store.get(f.work.id))!
    await f.delivery.configure({
      workstreamId: current.id,
      reportingId: 'board',
      revision: current.revision,
      grantRevision: (await f.delivery.grant(current.id, 'board')).revision,
      settings: { mode: 'review', target: TARGET, maxPerDay: 1 },
    })
    const prepared = await f.dispatch()
    const file = path.join(f.store.contentRoot, path.dirname(f.work.path), 'deliveries', `${prepared.id}.md`)
    await writeFile(file, (await readFile(file, 'utf8')).replace('status: review', 'status: sending'))
    const uncertain = await f.delivery.reconcilePending(f.work.id)
    found = true
    const reconciled = await f.delivery.reconcilePending(f.work.id)
    assert({
      given: 'an orphaned sending record from an interrupted attempt',
      should: 'retain uncertainty until read-only reconciliation finds a receipt, with no retry',
      actual: [uncertain[0].status, reconciled[0].status, posts],
      expected: ['unknown', 'sent', 0],
    })
  } finally {
    await f.clean()
  }
})

test('self-workstream source stays stable through report handoff but changes with business context', async () => {
  const f = await fixture()
  try {
    let work = (await f.store.get(f.work.id))!
    work = await f.store.put(
      {
        ...work,
        sources: [{ id: 'self', path: work.path, label: 'Workstream', sensitive: false }],
        reporting: work.reporting.map((policy) => ({ ...policy, permittedSourceIds: ['self'] })),
      },
      work.revision,
    )
    const before = await f.delivery.sourceVersions(work, work.reporting[0])
    const prepared = await f.dispatch()
    const afterHandoff = (await f.store.get(work.id))!
    const after = await f.delivery.sourceVersions(afterHandoff, afterHandoff.reporting[0])
    const changed = await f.store.put(
      { ...afterHandoff, notes: 'The launch scope has changed.' },
      afterHandoff.revision,
    )
    const changedVersion = await f.delivery.sourceVersions(changed, changed.reporting[0])
    assert({
      given: 'a workstream selected as a permitted report source',
      should: 'ignore its own report bookkeeping while retaining changes to business facts',
      actual: [prepared.status, before.self === after.self, before.self !== changedVersion.self],
      expected: ['review', true, true],
    })
  } finally {
    await f.clean()
  }
})

test('report review accepts the complete generated report and required attachment approval', async () => {
  const f = await fixture(undefined, ['Presentation'])
  try {
    const body = 'Atlas update. '.repeat(1800)
    const file = path.join(f.store.contentRoot, f.artifact.path)
    await writeFile(file, (await readFile(file, 'utf8')).replace('The launch brief is awaiting approval.', body))
    const prepared = await f.dispatch()
    const sent = await f.delivery.approve({
      workstreamId: f.work.id,
      deliveryId: prepared.id,
      revision: prepared.revision,
      target: TARGET,
      attachments: [{ name: 'Presentation', url: 'https://example.com/atlas-deck' }],
    })
    assert({
      given: 'a full report above 20,000 characters and a required presentation supplied at review',
      should: 'preserve all wording in the existing Outbox and send after explicit approval',
      actual: [prepared.body.trim() === body.trim(), sent.status, sent.blockers, f.sends()],
      expected: [true, 'sent', [], 1],
    })
  } finally {
    await f.clean()
  }
})

test('a report already sent by its owner cannot be sent again by the delivery queue', async () => {
  const f = await fixture()
  try {
    const prepared = await f.dispatch()
    const item = (await f.outboxStore.get(prepared.outboxId!))!
    await f.outbox.reportSent(item.id, item.revision, 'Sent from Slack after review.')
    const pending = (await f.delivery.get(f.work.id, prepared.id))!
    const refused = await f.delivery.approve({
      workstreamId: f.work.id,
      deliveryId: pending.id,
      revision: pending.revision,
      target: TARGET,
    })
    const reconciled = await f.delivery.reconcilePending(f.work.id)
    assert({
      given: 'the owner reports sending a pending report from the native app',
      should: 'refuse another send and retain the owner report without inventing a provider receipt',
      actual: [
        refused.status,
        f.sends(),
        reconciled[0].status,
        Boolean(reconciled[0].receipt),
        reconciled[0].reconciliation?.evidence,
      ],
      expected: ['review', 0, 'unknown', false, 'Sent from Slack after review.'],
    })
  } finally {
    await f.clean()
  }
})

test('automatic delivery requires the original authority snapshot from report preparation', async () => {
  const f = await fixture()
  try {
    await f.enable()
    const prepared = await f.dispatch({ expectedGrantRevision: undefined })
    assert({
      given: 'a standing send grant without the report’s original authority revision',
      should: 'keep the report in review instead of applying authority granted after drafting',
      actual: [prepared.status, f.sends(), prepared.blockers.some((blocker) => blocker.includes('authority changed'))],
      expected: ['review', 0, true],
    })
  } finally {
    await f.clean()
  }
})

test('report delivery excludes sensitive sources from sending and Outbox review context', async () => {
  const observed: unknown[] = []
  for (const automatic of [false, true]) {
    const f = await fixture()
    try {
      let work = (await f.store.get(f.work.id))!
      work = await f.store.put(
        {
          ...work,
          sources: [
            ...work.sources,
            { id: 'private', path: 'excluded-private.md', label: 'Private context', sensitive: true },
          ],
          reporting: work.reporting.map((policy) => ({
            ...policy,
            permittedSourceIds: ['public', 'private'],
            allowSensitive: false,
          })),
        },
        work.revision,
      )
      if (automatic) await f.enable()
      const prepared = await f.dispatch()
      const item = prepared.outboxId ? await f.outboxStore.get(prepared.outboxId) : null
      const sent = automatic
        ? prepared
        : await f.delivery.approve({
            workstreamId: work.id,
            deliveryId: prepared.id,
            revision: prepared.revision,
            target: TARGET,
          })
      observed.push([
        sent.status,
        Object.keys(sent.sourceVersions),
        item?.workstreams?.[0].sourceIds ?? ['public'],
        f.sends(),
        f.sentBodies[0].includes('The launch brief is awaiting approval.'),
      ])
    } finally {
      await f.clean()
    }
  }
  assert({
    given: 'public context and excluded sensitive context whose file cannot be read',
    should: 'send the public report through standing or manual review without reading or linking the excluded source',
    actual: observed,
    expected: [
      ['sent', ['public'], ['public'], 1, true],
      ['sent', ['public'], ['public'], 1, true],
    ],
  })
})

test('no authorized report context requires owner review and retains factual blockers', async () => {
  const observed: unknown[] = []
  for (const factualMissing of [false, true]) {
    const f = await fixture()
    try {
      let work = (await f.store.get(f.work.id))!
      work = await f.store.put(
        { ...work, sources: work.sources.map((source) => ({ ...source, sensitive: true })) },
        work.revision,
      )
      await f.enable()
      const prepared = await f.dispatch({ missingInputs: factualMissing ? ['Confirm the launch status'] : [] })
      await f.delivery.reconcilePending(work.id)
      const pending = (await f.delivery.get(work.id, prepared.id))!
      const before = f.sends()
      const manual = await f.delivery.approve({
        workstreamId: work.id,
        deliveryId: pending.id,
        revision: pending.revision,
      })
      observed.push([
        prepared.status,
        Object.keys(prepared.sourceVersions),
        prepared.error?.includes('No authorized source context'),
        before,
        manual.status,
        f.sends(),
      ])
    } finally {
      await f.clean()
    }
  }
  assert({
    given: 'an audience with all selected sources excluded, with or without unresolved factual inputs',
    should: 'never send automatically; explicit owner review can send only when factual inputs are complete',
    actual: observed,
    expected: [
      ['review', [], true, 0, 'sent', 1],
      ['review', [], true, 0, 'review', 0],
    ],
  })
})

test('missing selected report sources still refuse delivery snapshots', async () => {
  const f = await fixture()
  try {
    const work = (await f.store.get(f.work.id))!
    let refused = false
    try {
      await f.delivery.sourceVersions(work, { ...work.reporting[0], permittedSourceIds: ['missing'] })
    } catch {
      refused = true
    }
    assert({
      given: 'a reporting policy naming a source that no longer exists',
      should: 'refuse its snapshot instead of silently treating missing context as excluded',
      actual: refused,
      expected: true,
    })
  } finally {
    await f.clean()
  }
})

async function addReport(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  body = 'The updated launch brief is ready.',
) {
  const work = (await f.store.get(f.work.id))!
  const artifact = { ...f.artifact, id, path: path.join(path.dirname(work.path), 'artifacts', `${id}.md`) }
  await f.store.writeArtifact(work.id, artifact, body)
  await f.store.put({ ...work, artifacts: [...work.artifacts, artifact] }, work.revision)
  return artifact
}

test('fresh reports supersede unsent reviews while preserving the owner’s edited wording', async () => {
  const f = await fixture()
  try {
    const previous = await f.dispatch({ missingInputs: ['Add the presentation link.'] })
    const item = (await f.outboxStore.get(previous.outboxId!))!
    await f.outboxStore.put(
      { ...item, draft: 'The owner’s carefully edited Atlas update.', edited: true },
      item.revision,
    )
    const artifact = await addReport(f, 'report-2')
    const replacement = await f.dispatch({ artifactId: artifact.id })
    const archived = (await f.delivery.get(f.work.id, previous.id))!
    let refused = false
    try {
      await f.delivery.approve({
        workstreamId: f.work.id,
        deliveryId: previous.id,
        revision: archived.revision,
        target: TARGET,
      })
    } catch {
      refused = true
    }
    await f.delivery.reconcilePending(f.work.id)
    assert({
      given: 'a fresh report replacing an incomplete update edited in Outbox',
      should: 'archive only the older review, preserve its wording and prevent sending the superseded report',
      actual: [
        archived.status,
        archived.supersededById,
        archived.body.trim(),
        (await f.outboxStore.get(item.id))!.status,
        replacement.status,
        refused,
        (await f.delivery.list(f.work.id)).deliveries[0].id,
      ],
      expected: [
        'superseded',
        replacement.id,
        'The owner’s carefully edited Atlas update.',
        'dismissed',
        'review',
        true,
        replacement.id,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('interrupted supersession preserves a racing edit and resumes archival without another report', async () => {
  const f = await fixture()
  try {
    const old = await f.dispatch()
    const artifact = await addReport(f, 'report-2')
    const put = f.outboxStore.put.bind(f.outboxStore)
    let interrupted = false
    f.outboxStore.put = async (item, revision) => {
      if (!interrupted && item.id === old.outboxId && item.status === 'dismissed') {
        interrupted = true
        await put(
          { ...item, status: 'needs_review', draft: 'An edit saved during replacement.', edited: true },
          revision,
        )
        throw new Error('Interrupted before archive')
      }
      return put(item, revision)
    }
    try {
      await f.dispatch({ artifactId: artifact.id })
    } catch {}
    f.outboxStore.put = put
    const replacement = await f.dispatch({ artifactId: artifact.id })
    await f.delivery.reconcilePending(f.work.id)
    const archived = (await f.delivery.get(f.work.id, old.id))!
    const current = (await f.delivery.get(f.work.id, replacement.id))!
    assert({
      given: 'a crash after supersession intent and a concurrent Outbox edit',
      should: 'retain the edit, repair archival and keep one current report intent',
      actual: [
        interrupted,
        archived.status,
        archived.body.trim(),
        (await f.outboxStore.get(old.outboxId!))!.status,
        Boolean(current.outboxId),
        (await f.delivery.list(f.work.id)).deliveries.length,
      ],
      expected: [true, 'superseded', 'An edit saved during replacement.', 'dismissed', true, 2],
    })
  } finally {
    await f.clean()
  }
})

test('fresh reports preserve prior native drafts and unresolved sends', async () => {
  const f = await fixture()
  try {
    const previous = await f.dispatch()
    const item = (await f.outboxStore.get(previous.outboxId!))!
    await f.outboxStore.put(
      { ...item, status: 'ready', native: { id: 'draft-1', url: 'https://example.com/native-draft' } },
      item.revision,
    )
    const artifact = await addReport(f, 'report-2')
    await f.dispatch({ artifactId: artifact.id })
    assert({
      given: 'a report already handed to the native app when a fresh report is prepared',
      should: 'retain the earlier native draft and its delivery review for verification',
      actual: [
        (await f.delivery.get(f.work.id, previous.id))!.status,
        (await f.outboxStore.get(item.id))!.status,
        (await f.outboxStore.get(item.id))!.native?.id,
      ],
      expected: ['review', 'ready', 'draft-1'],
    })
  } finally {
    await f.clean()
  }
  let found = false
  const uncertain = await fixture({
    send: async (_record, authorize) => {
      await authorize()
      throw new ReportSendUnknownError('Response lost')
    },
    reconcile: async () => (found ? RECEIPT : null),
  })
  try {
    await uncertain.enable()
    const previous = await uncertain.dispatch()
    const artifact = await addReport(uncertain, 'report-2')
    const fresh = await uncertain.dispatch({ artifactId: artifact.id })
    found = true
    await uncertain.delivery.reconcilePending(uncertain.work.id)
    assert({
      given: 'an older unknown send reconciled after a new report is awaiting review',
      should: 'retain the real old receipt without completing the new report’s shared activity',
      actual: [
        (await uncertain.delivery.get(uncertain.work.id, previous.id))!.status,
        fresh.status,
        (await uncertain.store.get(uncertain.work.id))!.activities.find((activity) => activity.id === fresh.activityId)
          ?.state,
      ],
      expected: ['sent', 'review', 'waiting'],
    })
  } finally {
    await uncertain.clean()
  }
})

test('weekly report links are content inputs and do not revoke standing audience authority', async () => {
  const f = await fixture(undefined, ['Presentation'])
  try {
    const firstLinks = [{ name: 'Presentation', url: 'https://example.com/week-one' }]
    const nextLinks = [{ name: 'Presentation', url: 'https://example.com/week-two' }]
    let work = (await f.store.get(f.work.id))!
    work = await f.store.put(
      { ...work, reporting: work.reporting.map((policy) => ({ ...policy, attachments: firstLinks })) },
      work.revision,
    )
    const { permission } = await f.enable()
    const first = await f.dispatch({ attachments: firstLinks })
    f.clock('2025-03-22 12:00')
    work = (await f.store.get(work.id))!
    await f.store.put(
      { ...work, reporting: work.reporting.map((policy) => ({ ...policy, attachments: nextLinks })) },
      work.revision,
    )
    const artifact = await addReport(f, 'report-2')
    const grant = await f.delivery.grant(work.id, 'board')
    const next = await f.dispatch({ artifactId: artifact.id, attachments: nextLinks })
    assert({
      given: 'weekly audience reports with new supplied presentation URLs',
      should: 'send both under the same standing grant while retaining each actual attachment snapshot',
      actual: [
        first.status,
        next.status,
        grant.scopeCurrent,
        grant.revision === permission.revision,
        f.sends(),
        first.attachments,
        next.attachments,
      ],
      expected: ['sent', 'sent', true, true, 2, firstLinks, nextLinks],
    })
  } finally {
    await f.clean()
  }
})

test('changed report links before the provider write require fresh preparation or exact owner review', async () => {
  let before: (() => Promise<void>) | undefined
  let posts = 0
  const f = await fixture({
    send: async (_record, authorize) => {
      if (before) await before()
      await authorize()
      posts++
      return RECEIPT
    },
  })
  try {
    const links = [{ name: 'Presentation', url: 'https://example.com/approved-version' }]
    let work = (await f.store.get(f.work.id))!
    work = await f.store.put(
      { ...work, reporting: work.reporting.map((policy) => ({ ...policy, attachments: links })) },
      work.revision,
    )
    await f.enable()
    before = async () => {
      const current = (await f.store.get(work.id))!
      await f.store.put(
        {
          ...current,
          reporting: current.reporting.map((policy) => ({
            ...policy,
            attachments: [{ name: 'Presentation', url: 'https://example.com/new-version' }],
          })),
        },
        current.revision,
      )
    }
    const failed = await f.dispatch({ attachments: links })
    before = undefined
    const grant = await f.delivery.grant(work.id, 'board')
    const beforeApproval = posts
    const sent = await f.delivery.approve({ workstreamId: work.id, deliveryId: failed.id, revision: failed.revision })
    assert({
      given: 'artifact URLs change immediately before a standing send',
      should:
        'keep authority current but refuse stale automatic links, while honoring an exact manually reviewed override',
      actual: [failed.status, grant.scopeCurrent, beforeApproval, sent.status, posts, sent.attachments],
      expected: ['failed', true, 0, 'sent', 1, links],
    })
  } finally {
    await f.clean()
  }
})
