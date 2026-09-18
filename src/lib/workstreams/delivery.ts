import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { z } from 'zod'
import { atomicWrite, hash, missing, readOptional, withLock } from '#lib/outbox/files.ts'
import type { OutboxStore } from '#lib/outbox/store.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { workstreamFile } from './files.ts'
import type { createWorkstreamOutbox } from './outbox.ts'
import { workstreamNow, type WorkstreamStore } from './store.ts'
import { ActivitySchema, Id, WorkstreamError, type Reporting, type WorkstreamRecord } from './types.ts'

const NO_REPORT_CONTEXT =
  'No authorized source context was supplied for this audience. Add permitted context or explicitly review this report before sending.'
const EMAIL_DRAFT_ONLY = 'Gmail is draft-only. This report stays in Outbox review; send email yourself from Gmail.'
const Email = z.string().email().max(320)
export const ReportDeliveryTargetSchema = z.discriminatedUnion('medium', [
  z.object({ medium: z.literal('email'), account: Email, to: z.array(Email).min(1).max(30) }),
  z.object({
    medium: z.literal('slack'),
    workspace: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value)
        return (
          url.protocol === 'https:' &&
          url.hostname.endsWith('.slack.com') &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password
        )
      }, 'Use the exact Slack workspace URL.'),
    channelId: z.string().regex(/^[CGD][A-Z0-9]{6,}$/),
    threadTs: z
      .string()
      .regex(/^\d+\.\d+$/)
      .optional(),
  }),
])
export const ReportDeliverySettingsSchema = z.object({
  mode: z.enum(['review', 'send']).default('review'),
  target: ReportDeliveryTargetSchema.optional(),
  maxPerDay: z.number().int().min(1).max(24).default(1),
})
const AttachmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z
    .string()
    .max(2_000)
    .url()
    .refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS artifact link.'),
})
const GrantSchema = ReportDeliverySettingsSchema.extend({
  workstreamId: Id,
  reportingId: Id,
  scopeVersion: z.string(),
  updated: z.string(),
})
const ReceiptSchema = z.object({ id: z.string().min(1), url: z.string().url(), medium: z.enum(['email', 'slack']) })
const DeliverySchema = z.object({
  id: Id,
  workstreamId: Id,
  reportingId: Id,
  artifactId: Id,
  activityId: Id,
  status: z.enum(['review', 'sending', 'sent', 'unknown', 'failed', 'superseded']),
  supersededById: Id.optional(),
  supersedesIds: z.array(Id).optional(),
  created: z.string(),
  updated: z.string(),
  title: z.string(),
  body: z.string(),
  artifactVersion: z.string(),
  policyVersion: z.string(),
  target: ReportDeliveryTargetSchema.optional(),
  attachments: z.array(AttachmentSchema),
  sourceVersions: z.record(z.string(), z.string()),
  grantRevision: z.string().optional(),
  blockers: z.array(z.string()),
  error: z.string().optional(),
  outboxId: z.string().optional(),
  outboxRevision: z.string().optional(),
  receipt: ReceiptSchema.optional(),
  sendingOwner: z.number().int().optional(),
  approval: z
    .object({ at: z.string(), actor: z.literal('human'), bodyVersion: z.string(), targetVersion: z.string() })
    .optional(),
  reconciliation: z.object({ at: z.string(), evidence: z.string() }).optional(),
})

export type ReportDeliveryTarget = z.infer<typeof ReportDeliveryTargetSchema>
export type ReportDeliverySettings = z.infer<typeof ReportDeliverySettingsSchema>
export type ReportDeliveryGrant = z.infer<typeof GrantSchema> & { revision: string; scopeCurrent: boolean }
export type ReportDeliveryRecord = z.infer<typeof DeliverySchema> & { revision: string }
export type ReportDeliveryReceipt = z.infer<typeof ReceiptSchema>
export type ReportDeliveryAttachment = z.infer<typeof AttachmentSchema>
export type ReportTransport = {
  send: (delivery: ReportDeliveryRecord, authorize: () => Promise<void>) => Promise<ReportDeliveryReceipt>
  reconcile?: (delivery: ReportDeliveryRecord) => Promise<ReportDeliveryReceipt | null>
}
export class ReportSendUnknownError extends Error {}
export class ReportSendRejectedError extends Error {}

export type DispatchReportInput = {
  workstreamId: string
  reportingId: string
  artifactId: string
  revision: string
  expectedGrantRevision?: string
  expectedSourceVersions?: Record<string, string>
  attachments?: ReportDeliveryAttachment[]
  missingInputs?: string[]
}
export type ReportDeliveryOptions = {
  store: WorkstreamStore
  outbox: ReturnType<typeof createWorkstreamOutbox>
  outboxStore: OutboxStore
  transport: ReportTransport
  now?: () => string
}

/** Reporting cadence fields are bookkeeping; audience, targets, instructions and source scope are authority. */
function policyVersion(policy: Reporting): string {
  const { nextDueAt: _next, lastPreparedAt: _last, attachments: _attachments, ...scope } = policy
  return hash(JSON.stringify(scope))
}

export function createReportDelivery(options: ReportDeliveryOptions) {
  const { store, outbox, outboxStore, transport } = options
  const now = options.now ?? workstreamNow
  const grantFile = (id: string, policy: string) =>
    path.join(store.stateDir, 'permissions', `report-${Id.parse(id)}-${Id.parse(policy)}.json`)
  const required = async (id: string) => {
    const work = await store.get(id)
    if (!work) throw new WorkstreamError('This workstream could not be found.', 404)
    return work
  }
  const policyOf = (work: WorkstreamRecord, id: string) => {
    const policy = work.reporting.find((entry) => entry.id === id)
    if (!policy) throw new WorkstreamError('This reporting policy no longer exists.', 404)
    return policy
  }
  const fileFor = async (workstreamId: string, id: string) => {
    const work = await required(workstreamId)
    return workstreamFile(
      store.contentRoot,
      path.join(store.contentRoot, path.dirname(work.path), 'deliveries', `${Id.parse(id)}.md`),
    )
  }
  async function get(workstreamId: string, id: string): Promise<ReportDeliveryRecord | null> {
    const text = await readOptional(await fileFor(workstreamId, id))
    if (text === undefined) return null
    const doc = Document.fromMarkdown(text)
    if (doc.yamlError) throw new WorkstreamError('This delivery record has invalid frontmatter.')
    const record = DeliverySchema.parse({ ...doc.yaml, body: doc.markdown })
    if (record.workstreamId !== workstreamId || record.id !== id)
      throw new WorkstreamError('This delivery identity does not match its file.')
    if (record.outboxId && ['review', 'failed'].includes(record.status)) {
      const item = await outboxStore.get(record.outboxId)
      if (item)
        return {
          ...record,
          body: item.draft,
          outboxRevision: item.revision,
          revision: hash(`${text}:${item.revision}`),
        }
    }
    return { ...record, revision: hash(text) }
  }
  async function save(record: z.infer<typeof DeliverySchema>, revision: string | null): Promise<ReportDeliveryRecord> {
    return withLock(path.join(store.stateDir, 'report-deliveries-write.lock'), async () => {
      const current = await get(record.workstreamId, record.id)
      if ((current?.revision ?? null) !== revision)
        throw new WorkstreamError('This report delivery changed. Reload before continuing.', 409)
      const { body, ...yaml } = DeliverySchema.parse(record)
      await atomicWrite(await fileFor(record.workstreamId, record.id), new Document(yaml, body).toMarkdown())
      return (await get(record.workstreamId, record.id))!
    })
  }
  async function grant(workstreamId: string, reportingId: string): Promise<ReportDeliveryGrant> {
    const raw = await readOptional(grantFile(workstreamId, reportingId))
    const value = raw
      ? GrantSchema.parse(JSON.parse(raw))
      : GrantSchema.parse({ workstreamId, reportingId, scopeVersion: '', updated: '', mode: 'review' })
    if (value.workstreamId !== workstreamId || value.reportingId !== reportingId)
      throw new WorkstreamError('Report delivery authority has mismatched identity.')
    const policy = policyOf(await required(workstreamId), reportingId)
    return {
      ...value,
      // Previously saved grants remain readable but cannot authorize a new email send.
      mode: policy.medium === 'email' || value.target?.medium === 'email' ? 'review' : value.mode,
      revision: hash(raw ?? ''),
      scopeCurrent: value.scopeVersion === policyVersion(policy),
    }
  }
  async function configure(input: {
    workstreamId: string
    reportingId: string
    revision: string
    grantRevision: string
    settings: ReportDeliverySettings
  }): Promise<ReportDeliveryGrant> {
    await store.initialize()
    return withLock(path.join(store.stateDir, 'write.lock'), async () => {
      const work = await required(input.workstreamId)
      if (work.revision !== input.revision)
        throw new WorkstreamError('The reporting context changed. Reload before authorizing delivery.', 409)
      const policy = policyOf(work, input.reportingId)
      const current = await grant(work.id, policy.id)
      if (current.revision !== input.grantRevision)
        throw new WorkstreamError('Delivery authority changed. Reload before replacing it.', 409)
      const settings = ReportDeliverySettingsSchema.parse(input.settings)
      if (settings.mode === 'send' && (policy.medium === 'email' || settings.target?.medium === 'email'))
        throw new WorkstreamError(EMAIL_DRAFT_ONLY)
      if (settings.mode === 'send' && !settings.target)
        throw new WorkstreamError(
          'Choose the exact account and recipient or Slack conversation before authorizing delivery.',
        )
      if (settings.target && settings.target.medium !== policy.medium)
        throw new WorkstreamError('The delivery medium must match the reporting policy.')
      await atomicWrite(
        grantFile(work.id, policy.id),
        JSON.stringify({
          ...settings,
          workstreamId: work.id,
          reportingId: policy.id,
          scopeVersion: policyVersion(policy),
          updated: now(),
        }),
      )
      return grant(work.id, policy.id)
    })
  }
  async function list(
    workstreamId: string,
  ): Promise<{ grants: ReportDeliveryGrant[]; deliveries: ReportDeliveryRecord[] }> {
    const work = await required(workstreamId)
    const grants = await Promise.all(work.reporting.map((policy) => grant(work.id, policy.id)))
    const folder = await workstreamFile(
      store.contentRoot,
      path.join(store.contentRoot, path.dirname(work.path), 'deliveries'),
    )
    let files: string[]
    try {
      files = await readdir(folder)
    } catch (error) {
      if (!missing(error)) throw error
      files = []
    }
    const deliveries: ReportDeliveryRecord[] = []
    for (const file of files.filter((name) => /^[a-zA-Z0-9_-]+\.md$/.test(name))) {
      const record = await get(work.id, file.slice(0, -3))
      if (record) deliveries.push(record)
    }
    return {
      grants,
      deliveries: deliveries.sort(
        (a, b) =>
          b.created.localeCompare(a.created) ||
          work.artifacts.findIndex((artifact) => artifact.id === b.artifactId) -
            work.artifacts.findIndex((artifact) => artifact.id === a.artifactId),
      ),
    }
  }
  async function sourceVersions(work: WorkstreamRecord, policy: Reporting): Promise<Record<string, string>> {
    const versions: Record<string, string> = {}
    for (const id of policy.permittedSourceIds) {
      const source = work.sources.find((entry) => entry.id === id)
      if (!source) throw new WorkstreamError('A selected reporting source no longer exists.')
      if (source.sensitive && !policy.allowSensitive) continue
      // A full workstream source changes through ordinary report bookkeeping; its business revision is bound below.
      if (path.normalize(source.path) === path.normalize(work.path)) {
        const {
          revision: _revision,
          path: _path,
          updated: _updated,
          history: _history,
          sky: _sky,
          artifacts: _artifacts,
          reporting: _reporting,
          ...context
        } = work
        versions[id] = hash(
          JSON.stringify({
            ...context,
            activities: context.activities.filter((activity) => !activity.reportingPolicyId),
          }),
        )
      } else {
        const text = await readOptional(await store.resolveFile(source.path))
        if (text === undefined || text.length > 1_000_000)
          throw new WorkstreamError('A permitted reporting source could not be checked.')
        versions[id] = hash(text)
      }
    }
    return versions
  }
  function blockersFor(
    policy: Reporting,
    attachments: ReportDeliveryAttachment[],
    target?: ReportDeliveryTarget,
  ): string[] {
    const blockers = policy.artifacts
      .filter((name) => !attachments.some((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase()))
      .map((name) => `Required artifact is missing: ${name}.`)
    if (!target) blockers.push('An exact delivery destination has not been authorized.')
    return blockers
  }
  async function reviewFallback(record: ReportDeliveryRecord): Promise<ReportDeliveryRecord> {
    if (record.outboxId || record.status !== 'review') return record
    let work = await required(record.workstreamId)
    const policy = policyOf(work, record.reportingId)
    const previous = work.activities.find((activity) => activity.id === record.activityId)
    if (!previous || previous.state !== 'waiting' || !previous.artifactIds.includes(record.artifactId)) {
      const activity = ActivitySchema.parse({
        ...previous,
        id: record.activityId,
        title: `Update ${policy.audience}`,
        kind: 'report',
        executor: 'sky',
        state: 'waiting',
        result: '',
        waitingFor: 'Review of the prepared audience update.',
        reportingPolicyId: policy.id,
        artifactIds: [...new Set([...(previous?.artifactIds ?? []), record.artifactId])],
      })
      work = await store.put(
        { ...work, activities: [...work.activities.filter((entry) => entry.id !== activity.id), activity] },
        work.revision,
      )
    }
    const prepared = await outbox.prepare({
      workstreamId: work.id,
      activityId: record.activityId,
      revision: work.revision,
      intentId: `report-${record.id}`,
      title: record.title,
      draft: record.body,
      medium: policy.medium === 'slack' ? 'Slack' : 'Email',
      destination: policy.destination,
      sourceIds: Object.keys(record.sourceVersions).filter(
        (id) => work.sources.find((source) => source.id === id)?.path !== work.path,
      ),
    })
    return save({ ...record, outboxId: prepared.item.id, updated: now() }, record.revision)
  }

  async function emailDraft(record: ReportDeliveryRecord): Promise<ReportDeliveryRecord> {
    if (!['review', 'failed'].includes(record.status)) return record
    if (record.status !== 'review' || record.error !== EMAIL_DRAFT_ONLY)
      record = await save({ ...record, status: 'review', error: EMAIL_DRAFT_ONLY, updated: now() }, record.revision)
    return reviewFallback(record)
  }

  /** A saved replacement intent survives a crash between ledger replacement and Outbox archival. */
  async function supersedeOlder(replacement: ReportDeliveryRecord): Promise<void> {
    for (const id of replacement.supersedesIds ?? []) {
      let previous = await get(replacement.workstreamId, id)
      if (!previous || previous.reportingId !== replacement.reportingId || previous.receipt) continue
      const alreadyReplaced = previous.status === 'superseded' && previous.supersededById === replacement.id
      if (!alreadyReplaced && !['review', 'failed'].includes(previous.status)) continue
      const item = previous.outboxId ? await outboxStore.get(previous.outboxId) : null
      if (item && (item.native || item.delivery || !['needs_review', 'dismissed'].includes(item.status))) continue
      // Copy the latest reviewed wording before archiving. Outbox's own revision preserves racing edits.
      if (!alreadyReplaced || (item && item.draft !== previous.body)) {
        previous = await save(
          {
            ...previous,
            body: item?.draft ?? previous.body,
            status: 'superseded',
            supersededById: replacement.id,
            updated: now(),
          },
          previous.revision,
        )
      }
      if (item && item.status === 'needs_review')
        await outboxStore.put({ ...item, status: 'dismissed', updated: now() }, item.revision)
    }
  }

  async function authorize(record: ReportDeliveryRecord, manual: boolean): Promise<void> {
    if (record.target?.medium === 'email') throw new ReportSendRejectedError(EMAIL_DRAFT_ONLY)
    const work = await required(record.workstreamId)
    if (work.state !== 'active')
      throw new ReportSendRejectedError('Delivery is stopped while this workstream is not active.')
    const policy = policyOf(work, record.reportingId)
    if (policy.medium === 'email') throw new ReportSendRejectedError(EMAIL_DRAFT_ONLY)
    if (policyVersion(policy) !== record.policyVersion)
      throw new ReportSendRejectedError('The report audience or scope changed. Prepare a new update before sending.')
    if (hash((await store.readArtifact(work.id, record.artifactId)).content) !== record.artifactVersion)
      throw new ReportSendRejectedError(
        'The report artifact changed after delivery was prepared. Review a new delivery first.',
      )
    if (record.outboxId) {
      const item = await outboxStore.get(record.outboxId)
      if (!item || item.revision !== record.outboxRevision || item.draft.trim() !== record.body.trim())
        throw new ReportSendRejectedError('The report draft changed after review. Reload the current wording first.')
      if (item.status !== 'needs_review' || item.native || item.delivery)
        throw new ReportSendRejectedError(
          'This report has already left Outbox review. Check the native app before another delivery.',
        )
      if (!manual && item.edited)
        throw new ReportSendRejectedError('Your edited report draft needs explicit review before delivery.')
    }
    if (JSON.stringify(await sourceVersions(work, policy)) !== JSON.stringify(record.sourceVersions))
      throw new ReportSendRejectedError(
        'A permitted source changed after this report was prepared. Refresh the report before sending.',
      )
    if (blockersFor(policy, record.attachments, record.target).length || record.blockers.length)
      throw new ReportSendRejectedError('The report still has missing inputs or required artifacts.')
    if (!manual) {
      if (!Object.keys(record.sourceVersions).length) throw new ReportSendRejectedError(NO_REPORT_CONTEXT)
      if (JSON.stringify(policy.attachments ?? []) !== JSON.stringify(record.attachments))
        throw new ReportSendRejectedError(
          'The supplied report links changed after preparation. Prepare a fresh report or explicitly review the intended links.',
        )
      const permission = await grant(work.id, policy.id)
      if (
        permission.mode !== 'send' ||
        permission.revision !== record.grantRevision ||
        permission.scopeVersion !== record.policyVersion ||
        JSON.stringify(permission.target) !== JSON.stringify(record.target)
      )
        throw new ReportSendRejectedError('Standing report delivery authority changed. This update needs review.')
      if ((await store.getGrant(work.id)).mode === 'off')
        throw new ReportSendRejectedError(
          'Sky’s ongoing responsibility is off. Review this report to send it yourself.',
        )
    }
  }
  async function acknowledge(record: ReportDeliveryRecord): Promise<void> {
    if (!record.receipt || record.status !== 'sent') return
    const work = await required(record.workstreamId)
    const operationId = `report-sent:${record.id}`
    if (!work.history.some((entry) => entry.operationId === operationId)) {
      await store.put(
        {
          ...work,
          updated: now(),
          history: [
            ...work.history,
            {
              id: randomUUID(),
              at: now(),
              actor: 'sky',
              kind: 'report_sent',
              operationId,
              summary: `Delivered “${record.title}”: ${record.receipt.url}`,
              activityId: record.activityId,
            },
          ],
          activities: work.activities.map((activity) =>
            activity.id === record.activityId &&
            work.artifacts.filter((artifact) => artifact.reportingId === record.reportingId).at(-1)?.id ===
              record.artifactId
              ? { ...activity, state: 'done', result: `Sent report: ${record.receipt!.url}`, waitingFor: '' }
              : activity,
          ),
        },
        work.revision,
      )
    }
    if (record.outboxId) {
      const item = await outboxStore.get(record.outboxId)
      if (item && item.status !== 'dismissed' && item.status !== 'placing')
        await outboxStore.put({ ...item, status: 'dismissed', updated: now() }, item.revision)
    }
  }
  async function attempt(record: ReportDeliveryRecord, manual: boolean): Promise<ReportDeliveryRecord> {
    if (record.status === 'sent') {
      await acknowledge(record)
      return record
    }
    if (['sending', 'unknown', 'superseded'].includes(record.status)) return record
    if (record.status === 'failed' && !manual) return record
    try {
      await authorize(record, manual)
    } catch (error) {
      return reviewFallback(
        await save(
          {
            ...record,
            status: 'review',
            error: error instanceof Error ? error.message : 'Delivery needs review.',
            updated: now(),
          },
          record.revision,
        ),
      )
    }
    if (!manual) {
      const permission = await grant(record.workstreamId, record.reportingId)
      const used = (await list(record.workstreamId)).deliveries.filter(
        (item) =>
          item.id !== record.id &&
          item.reportingId === record.reportingId &&
          ['sent', 'sending', 'unknown'].includes(item.status) &&
          item.updated.slice(0, 10) === now().slice(0, 10),
      ).length
      if (used >= permission.maxPerDay)
        return reviewFallback(
          await save(
            { ...record, status: 'review', error: 'The daily delivery limit has been reached.', updated: now() },
            record.revision,
          ),
        )
    }
    let sending = await save(
      { ...record, status: 'sending', sendingOwner: process.pid, updated: now(), error: undefined },
      record.revision,
    )
    try {
      const receipt = ReceiptSchema.parse(await transport.send(sending, () => authorize(sending, manual)))
      if (receipt.medium !== sending.target?.medium)
        throw new ReportSendUnknownError('The provider receipt does not match the selected delivery medium.')
      sending = await save(
        { ...sending, status: 'sent', receipt, updated: now(), sendingOwner: undefined },
        sending.revision,
      )
      await acknowledge(sending)
      return sending
    } catch (error) {
      // A durable receipt is authoritative even if later history or Outbox bookkeeping fails.
      const latest = await get(sending.workstreamId, sending.id)
      if (latest?.status === 'sent') return latest
      return save(
        {
          ...sending,
          status: error instanceof ReportSendRejectedError ? 'failed' : 'unknown',
          error: error instanceof Error ? error.message : 'Delivery could not be confirmed.',
          updated: now(),
          sendingOwner: undefined,
        },
        sending.revision,
      )
    }
  }
  async function dispatch(input: DispatchReportInput): Promise<ReportDeliveryRecord> {
    return withLock(path.join(store.stateDir, `report-${Id.parse(input.workstreamId)}.lock`), async () => {
      const work = await required(input.workstreamId)
      const policy = policyOf(work, input.reportingId)
      if (!['email', 'slack'].includes(policy.medium))
        throw new WorkstreamError('This reporting medium produces a local artifact rather than an external message.')
      const id = hash(`report:${work.id}:${policy.id}:${input.artifactId}`).slice(0, 32)
      const existing = await get(work.id, id)
      if (existing) {
        await supersedeOlder(existing)
        if (existing.status === 'sent') await acknowledge(existing)
        if (policy.medium === 'email' || existing.target?.medium === 'email') return emailDraft(existing)
        return existing
      }
      if (work.revision !== input.revision)
        throw new WorkstreamError('The work changed before report delivery was prepared.', 409)
      const artifact = await store.readArtifact(work.id, input.artifactId)
      if (artifact.artifact.reportingId !== policy.id || artifact.artifact.kind !== 'report')
        throw new WorkstreamError('This artifact is not the report prepared for that audience.')
      const permission = await grant(work.id, policy.id)
      const versions = await sourceVersions(work, policy)
      const attachments = z
        .array(AttachmentSchema)
        .max(20)
        .parse(input.attachments ?? [])
      const blockers = [
        ...blockersFor(policy, attachments, permission.target),
        ...(input.missingInputs ?? []).map((item) => `Missing input: ${item}`),
      ]
      if (
        input.expectedSourceVersions === undefined ||
        JSON.stringify(input.expectedSourceVersions) !== JSON.stringify(versions)
      )
        blockers.push(
          'The report’s original source snapshot is unavailable or changed. Refresh the report before sending.',
        )
      if (
        (permission.mode === 'send' || input.expectedGrantRevision !== undefined) &&
        input.expectedGrantRevision !== permission.revision
      )
        blockers.push('Delivery authority changed while this report was prepared.')
      let record = await save(
        {
          id,
          workstreamId: work.id,
          reportingId: policy.id,
          artifactId: artifact.artifact.id,
          activityId: `report-${hash(policy.id).slice(0, 24)}`,
          supersedesIds: (await list(work.id)).deliveries
            .filter((previous) => previous.reportingId === policy.id && ['review', 'failed'].includes(previous.status))
            .map((previous) => previous.id),
          status: 'review',
          created: now(),
          updated: now(),
          title: artifact.artifact.title,
          body: artifact.content,
          artifactVersion: hash(artifact.content),
          policyVersion: policyVersion(policy),
          target: permission.target,
          attachments,
          sourceVersions: versions,
          error: Object.keys(versions).length ? undefined : NO_REPORT_CONTEXT,
          grantRevision: permission.revision,
          blockers,
        },
        null,
      )
      await supersedeOlder(record)
      if (policy.medium === 'email' || record.target?.medium === 'email') record = await emailDraft(record)
      else if (permission.mode === 'send' && permission.scopeVersion === record.policyVersion && !blockers.length)
        record = await attempt(record, false)
      else record = await reviewFallback(record)
      return record
    })
  }
  async function approve(input: {
    workstreamId: string
    deliveryId: string
    revision: string
    target?: ReportDeliveryTarget
    attachments?: ReportDeliveryAttachment[]
  }): Promise<ReportDeliveryRecord> {
    return withLock(path.join(store.stateDir, `report-${Id.parse(input.workstreamId)}.lock`), async () => {
      const current = await get(input.workstreamId, input.deliveryId)
      if (!current) throw new WorkstreamError('This report delivery could not be found.', 404)
      if (current.revision !== input.revision)
        throw new WorkstreamError('This delivery changed. Reload the actual report before approving it.', 409)
      const policy = policyOf(await required(input.workstreamId), current.reportingId)
      if (policy.medium === 'email' || current.target?.medium === 'email' || input.target?.medium === 'email')
        throw new WorkstreamError(EMAIL_DRAFT_ONLY)
      if (current.status === 'superseded')
        throw new WorkstreamError('A newer report replaced this update. Review the current report instead.', 409)
      if (['sent', 'sending', 'unknown'].includes(current.status))
        throw new WorkstreamError(
          'This report was sent or its delivery is uncertain. Reconcile it before another attempt.',
          409,
        )
      const target = input.target ? ReportDeliveryTargetSchema.parse(input.target) : current.target
      const attachments = input.attachments
        ? z.array(AttachmentSchema).max(20).parse(input.attachments)
        : current.attachments
      if (target?.medium !== policy.medium)
        throw new WorkstreamError('Choose the reporting policy’s configured medium.')
      const blockers = [
        ...blockersFor(policy, attachments, target),
        ...current.blockers.filter(
          (value) =>
            !value.startsWith('Required artifact is missing:') &&
            value !== 'An exact delivery destination has not been authorized.',
        ),
      ]
      const body = current.body
      const next = await save(
        {
          ...current,
          body,
          target,
          attachments,
          blockers,
          status: 'review',
          updated: now(),
          approval: { at: now(), actor: 'human', bodyVersion: hash(body), targetVersion: hash(JSON.stringify(target)) },
        },
        current.revision,
      )
      return attempt(next, true)
    })
  }
  async function revoke(input: {
    workstreamId: string
    reportingId: string
    revision: string
    grantRevision: string
  }): Promise<ReportDeliveryGrant> {
    const current = await grant(input.workstreamId, input.reportingId)
    return configure({ ...input, settings: { mode: 'review', target: current.target, maxPerDay: current.maxPerDay } })
  }
  async function reconcilePending(workstreamId: string): Promise<ReportDeliveryRecord[]> {
    return withLock(path.join(store.stateDir, `report-${Id.parse(workstreamId)}.lock`), async () => {
      const work = await required(workstreamId)
      for (const record of (await list(work.id)).deliveries) await supersedeOlder(record)
      const records = (await list(work.id)).deliveries
      const result: ReportDeliveryRecord[] = []
      const pending = records
        .filter(
          (record) =>
            record.status !== 'superseded' &&
            (record.status !== 'sent' ||
              !work.history.some((entry) => entry.operationId === `report-sent:${record.id}`)),
        )
        .sort(
          (a, b) =>
            Number(['unknown', 'sending'].includes(b.status)) - Number(['unknown', 'sending'].includes(a.status)),
        )
        .slice(0, 10)
      for (let record of pending) {
        if (record.outboxId && ['review', 'failed'].includes(record.status)) {
          const item = await outboxStore.get(record.outboxId)
          if (item?.delivery)
            record = await save(
              {
                ...record,
                status: 'unknown',
                updated: now(),
                error: 'The owner reported sending this report. Confirm its provider receipt before another delivery.',
                reconciliation: { at: item.delivery.at, evidence: item.delivery.evidence },
              },
              record.revision,
            )
        }
        if (record.status === 'sent') {
          await acknowledge(record)
          result.push(record)
          continue
        }
        if (record.status === 'sending') {
          // Holding the report lock means no live attempt owns this sending record, even if its process survived.
          record = await save(
            {
              ...record,
              status: 'unknown',
              sendingOwner: undefined,
              updated: now(),
              error: 'The process stopped before a provider receipt was saved.',
            },
            record.revision,
          )
        }
        if (record.status === 'unknown' && transport.reconcile) {
          const receipt = await transport
            .reconcile(record)
            .then((value) => (value ? ReceiptSchema.parse(value) : null))
            .catch(() => null)
          if (receipt && receipt.medium === record.target?.medium) {
            record = await save(
              { ...record, status: 'sent', receipt, updated: now(), error: undefined },
              record.revision,
            )
            await acknowledge(record)
          }
        } else if (
          ['review', 'failed'].includes(record.status) &&
          (record.target?.medium === 'email' ||
            work.reporting.find((policy) => policy.id === record.reportingId)?.medium === 'email')
        ) {
          record = await emailDraft(record)
        } else if (record.status === 'review' && work.state === 'active') {
          const permission = await grant(work.id, record.reportingId)
          if (permission.mode === 'send' && permission.scopeCurrent && !record.blockers.length)
            record = await attempt(record, false)
          else if (!record.outboxId) record = await reviewFallback(record)
        }
        result.push(record)
      }
      return result
    })
  }
  return { configure, revoke, grant, list, get, sourceVersions, dispatch, approve, reconcilePending }
}
