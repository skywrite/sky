import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { atomicWrite, hash, readOptional, withLock } from '#lib/outbox/files.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { verifyActionArtifact, type ActionAssessment, type ActionVerification } from './actionOutcome.ts'
import {
  assessWorkstreamAction,
  prepareWorkstreamReport,
  proposeWorkstream,
  WorkstreamReportSchema,
  WorkstreamReviewSchema,
  type WorkstreamProposer,
  type WorkstreamReporter,
  type WorkstreamReview,
  type ActionAssessor,
} from './ai.ts'
import { applyDecisionEvaluation, evaluateDecision } from './decisionPolicy.ts'
import type { createReportDelivery, ReportDeliveryGrant } from './delivery.ts'
import { relationshipProposal } from './relationships.ts'
import type { WorkstreamStore } from './store.ts'
import {
  ActivitySchema,
  Id,
  ReportingSchema,
  WorkstreamError,
  type Artifact,
  type SkyGrant,
  type Workstream,
  type WorkstreamRecord,
  type WorkstreamRun,
  type WorkstreamSource,
} from './types.ts'

type SourceSnapshot = WorkstreamSource & { content: string; version: string; error?: string; truncated: boolean }
type ArtifactSnapshot = {
  id: string
  title: string
  content: string
  version: string
  error?: string
  truncated: boolean
}
const CheckpointSchema = z.object({
  fingerprint: z.string(),
  checkedAt: z.string(),
  nextCheckAt: z.string(),
  lastRunId: z.string(),
})
const ReportIntentSchema = z.object({
  reportArtifactId: Id,
  reportingId: Id,
  reportGrantRevision: z.string(),
  reportSourceVersions: z.record(z.string(), z.string()),
  reportMissingInputs: z.array(z.string()).default([]),
  reportAttachments: ReportingSchema.shape.attachments,
})

export type RunWorkstreamOptions = {
  store: WorkstreamStore
  id: string
  now: string
  trigger?: WorkstreamRun['trigger']
  request?: string
  reportingId?: string
  propose?: WorkstreamProposer
  report?: WorkstreamReporter
  verifyAction?: ActionAssessor
  prepareCommunication?: PrepareWorkstreamCommunication
  readCommunications?: (id: string) => Promise<Record<string, unknown>[]>
  reportDelivery?: Pick<
    ReturnType<typeof createReportDelivery>,
    'grant' | 'dispatch' | 'reconcilePending' | 'sourceVersions'
  >
}

export type PrepareWorkstreamCommunication = (input: {
  workstreamId: string
  activityId: string
  revision: string
  expectedGrantRevision: string
  allowManual: boolean
  intentId: string
  sourceIds: string[]
  expectedSourceVersions: Record<string, string>
  sourceRef?: string
  title: string
  draft: string
  medium: 'Email' | 'Slack'
  destination?: string
  actor: 'sky'
}) => Promise<{ workstream: WorkstreamRecord; item: { id: string } }>

export type WorkstreamScanReport = {
  outcome: 'acted' | 'nothing' | 'failed'
  considered: number
  reviewed: number
  failed: number
  skipped: number
  errors: { id: string; message: string }[]
}

function later(now: string, minutes: number): string {
  const value = new PlainDateTime(now)
  return new PlainDateTime({ date: value.plainDate.addDays(Math.floor(minutes / 1440)).ymd, time: value.time })
    .addHours((minutes % 1440) / 60)
    .normalize()
    .toString()
}

function stamp(now: string): string {
  return new PlainDateTime(now).normalize().toString()
}

function due(at: string | undefined, now: string): boolean {
  return !at || stamp(at) <= now
}

async function sourcesFor(store: WorkstreamStore, workstream: WorkstreamRecord): Promise<SourceSnapshot[]> {
  let remaining = 64_000
  const snapshots: SourceSnapshot[] = []
  for (const source of workstream.sources.slice(0, 20)) {
    try {
      if (path.normalize(source.path) === path.normalize(workstream.path)) {
        snapshots.push({ ...source, content: '', version: 'workstream-context', truncated: false })
        continue
      }
      const file = await store.resolveFile(source.path)
      if (!/\.(md|txt)$/i.test(file)) throw new Error('Select a Markdown or text source.')
      if ((await stat(file)).size > 1_000_000) throw new Error('This source is too large. Select a smaller excerpt.')
      const text = await readFile(file, 'utf8')
      const available = Math.min(remaining, 16_000)
      const content = text.slice(0, available)
      remaining -= content.length
      snapshots.push({ ...source, content, version: hash(text), truncated: content.length < text.length })
    } catch (error) {
      snapshots.push({
        ...source,
        content: '',
        version: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
        truncated: false,
      })
    }
  }
  return snapshots
}

async function artifactsFor(store: WorkstreamStore, workstream: WorkstreamRecord): Promise<ArtifactSnapshot[]> {
  let remaining = 40_000
  const snapshots: ArtifactSnapshot[] = []
  for (const artifact of workstream.artifacts.slice(-6).reverse()) {
    try {
      const saved = await store.readArtifact(workstream.id, artifact.id)
      const content = saved.content.slice(0, Math.min(remaining, 12_000))
      remaining -= content.length
      snapshots.push({
        id: artifact.id,
        title: artifact.title,
        content,
        version: hash(saved.content),
        truncated: content.length < saved.content.length,
      })
    } catch (error) {
      snapshots.push({
        id: artifact.id,
        title: artifact.title,
        content: '',
        version: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
        truncated: false,
      })
    }
  }
  return snapshots
}

function relatedContext(workstream: WorkstreamRecord, peers: WorkstreamRecord[]) {
  const relatedIds = new Set([
    workstream.parentId,
    ...workstream.relations.map((relation) => relation.targetId),
    ...workstream.activities.flatMap((activity) => activity.requires.map((requirement) => requirement.workstreamId)),
  ])
  for (const requirement of workstream.activities.flatMap((activity) => activity.requires)) {
    const activity = peers
      .find((peer) => peer.id === requirement.workstreamId)
      ?.activities.find((candidate) => candidate.id === requirement.activityId)
    if (activity?.subworkstreamId) relatedIds.add(activity.subworkstreamId)
  }
  return peers
    .filter(
      (peer) =>
        peer.id !== workstream.id &&
        (relatedIds.has(peer.id) ||
          peer.parentId === workstream.id ||
          peer.relations.some((relation) => relation.targetId === workstream.id) ||
          peer.activities.some((activity) =>
            activity.requires.some((requirement) => requirement.workstreamId === workstream.id),
          )),
    )
    .map((peer) => ({
      id: peer.id,
      title: peer.title,
      outcome: peer.outcome,
      state: peer.state,
      parentId: peer.parentId,
      relations: peer.relations,
      start: peer.start,
      due: peer.due,
      activities: peer.activities.map(
        ({ id, title, outcome, state, result, requires, waitingFor, start, end, due }) => ({
          id,
          title,
          outcome,
          state,
          result,
          requires,
          waitingFor,
          start,
          end,
          due,
        }),
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function fingerprint(
  workstream: WorkstreamRecord,
  sources: SourceSnapshot[],
  grant: SkyGrant,
  peers: WorkstreamRecord[],
  now: string,
  artifacts: ArtifactSnapshot[],
  communications: Record<string, unknown>[] = [],
): string {
  const { revision: _revision, path: _path, updated: _updated, history: _history, sky, ...work } = workstream
  const related = relatedContext(workstream, peers)
  const datesReached = [
    workstream.start,
    workstream.due,
    ...workstream.activities.flatMap((activity) => [activity.start, activity.due]),
  ].filter((date): date is string => Boolean(date && date <= now.slice(0, 10)))
  return hash(
    JSON.stringify({
      work,
      sources: sources.map(({ id, version }) => ({ id, version })),
      artifacts: artifacts.map(({ id, version }) => ({ id, version })),
      communications: communications
        .map((communication) => ({
          id: communication.id,
          version: communication.version ?? hash(JSON.stringify(communication)),
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      grant,
      instruction: sky.instruction,
      related,
      datesReached,
    }),
  )
}

function nothing(id: string, now: string, trigger: WorkstreamRun['trigger'], summary: string): WorkstreamRun {
  return {
    id: randomUUID(),
    workstreamId: id,
    status: 'nothing',
    trigger,
    started: now,
    finished: now,
    summary,
    artifactIds: [],
  }
}

function eligible(
  workstream: WorkstreamRecord,
  records: WorkstreamRecord[],
  options: { grant?: SkyGrant; allowRecheck?: boolean } = {},
): string[] {
  return workstream.activities
    .filter(
      (activity) =>
        activity.executor === 'sky' &&
        activity.kind !== 'decision' &&
        !activity.subworkstreamId &&
        (activity.state === 'ready' ||
          (options.allowRecheck === true &&
            activity.state === 'waiting' &&
            !activity.outboxId &&
            options.grant?.actionPolicies[activity.id]?.activityTitle === activity.title &&
            activity.actionVerification?.outcome === 'needs_review' &&
            !activity.actionVerification.requiresExternalResult)),
    )
    .filter((activity) =>
      activity.requires.every((requirement) => {
        const parent = records.find((record) => record.id === requirement.workstreamId)
        return parent?.activities.some(
          (candidate) =>
            candidate.id === requirement.activityId &&
            (candidate.subworkstreamId
              ? records.some((child) => child.id === candidate.subworkstreamId && child.state === 'completed')
              : candidate.state === 'done'),
        )
      }),
    )
    .map((activity) => activity.id)
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function applyReview(workstream: WorkstreamRecord, review: WorkstreamReview, mode: SkyGrant['mode']): Workstream {
  const next: Workstream = structuredClone(workstream)
  next.understanding = review.understanding || next.understanding
  next.unknowns = review.unknowns
  const titles = new Set(next.activities.map((activity) => normalize(activity.title)))
  let added = 0
  for (const decision of review.decisions) {
    if (added >= 2 || titles.has(normalize(decision.question))) continue
    next.activities.push(
      ActivitySchema.parse({
        id: randomUUID(),
        title: decision.question,
        kind: 'decision',
        state: 'ready',
        notes: decision.context,
        recommendation: decision.recommendation,
      }),
    )
    titles.add(normalize(decision.question))
    added++
  }
  for (const action of review.activities) {
    if (added >= 2 || titles.has(normalize(action.title))) continue
    next.activities.push(
      ActivitySchema.parse({
        id: randomUUID(),
        title: action.title,
        notes: action.description,
        executor: action.executor,
        state: mode === 'drive' && action.executor === 'sky' ? 'ready' : 'proposed',
      }),
    )
    titles.add(normalize(action.title))
    added++
  }
  const proposals = [...next.proposals]
  const propose = (proposal: Omit<Workstream['proposals'][number], 'id'>) => {
    if (proposals.length >= 40) return
    if (
      !proposals.some(
        (prior) =>
          prior.kind === proposal.kind &&
          prior.title === proposal.title &&
          prior.targetId === proposal.targetId &&
          prior.relationKind === proposal.relationKind &&
          prior.activityId === proposal.activityId &&
          prior.requiredActivityId === proposal.requiredActivityId &&
          prior.requiredResult === proposal.requiredResult,
      )
    )
      proposals.push({ id: randomUUID(), ...proposal })
  }
  if (review.outcomeSuggestion && normalize(review.outcomeSuggestion) !== normalize(workstream.outcome))
    propose({
      kind: 'outcome',
      title: 'Refine the desired outcome',
      outcome: review.outcomeSuggestion,
      reason: review.summary,
    })
  for (const suggestion of review.suggestions)
    propose({ kind: 'suggestion', title: suggestion, reason: 'Sky suggests reviewing this coordination need.' })
  for (const child of review.subworkstreams)
    propose({ kind: 'subworkstream', title: child.title, outcome: child.outcome, reason: child.reason })
  for (const relation of review.relationships) propose(relationshipProposal(relation))
  if (
    review.coordination &&
    (review.coordination.stakeholders?.length ||
      review.coordination.reporting?.length ||
      review.coordination.metrics?.length ||
      review.coordination.timeline)
  ) {
    const coordination = review.coordination
    const pending = proposals.find((prior) => prior.kind === 'coordination')
    if (pending) pending.coordination = { ...pending.coordination, ...coordination }
    else if (proposals.length < 40)
      proposals.push({
        id: randomUUID(),
        kind: 'coordination',
        title: 'People, timing, and reporting',
        reason:
          'Sky proposes these arrangements for your review. Accepting them does not grant sending or sensitive-source access.',
        coordination,
      })
  }
  next.proposals = proposals
  return next
}

async function reconcile(
  store: WorkstreamStore,
  workstream: WorkstreamRecord,
  runs: WorkstreamRun[],
  now: string,
): Promise<boolean> {
  let interrupted = false
  for (const run of runs.filter((candidate) => candidate.status === 'running')) {
    const applied =
      workstream.history.some((entry) => entry.operationId === run.id) &&
      (run.phase !== 'awaiting_outbox' ||
        workstream.activities.some((activity) => activity.id === run.communicationActivityId && activity.outboxId))
    await store.putRun({
      ...run,
      status: applied ? 'completed' : 'interrupted',
      finished: now,
      summary: applied
        ? 'Recovered the recorded result after interruption.'
        : 'The previous attempt stopped before its result was confirmed. Review its local artifacts, then run Sky again to continue.',
    })
    interrupted ||= !applied
  }
  return interrupted
}

async function attention(store: WorkstreamStore, id: string, now: string, message: string): Promise<void> {
  try {
    const work = await store.get(id)
    if (!work || (work.sky.error === message && work.sky.lastSummary === message)) return
    await store.put(
      { ...work, updated: now, sky: { ...work.sky, error: message, lastSummary: message } },
      work.revision,
    )
  } catch {
    // A concurrent owner edit wins. The durable run still exposes this attempt's failure.
  }
}

function reportingSource(source: SourceSnapshot, workstream: WorkstreamRecord): SourceSnapshot {
  if (source.version !== 'workstream-context') return source
  const {
    title,
    outcome,
    understanding,
    unknowns,
    notes,
    state,
    activities,
    stakeholders,
    metrics,
    start,
    due: deadline,
  } = workstream
  const content = JSON.stringify(
    { title, outcome, understanding, unknowns, notes, state, activities, stakeholders, metrics, start, due: deadline },
    null,
    2,
  )
  return { ...source, content: content.slice(0, 24_000), version: hash(content), truncated: content.length > 24_000 }
}

/** One workstream-aware operation for a person, a context update, or the existing scheduler. */
export async function runWorkstream(options: RunWorkstreamOptions): Promise<WorkstreamRun> {
  const {
    store,
    id,
    request,
    propose = proposeWorkstream,
    report = prepareWorkstreamReport,
    verifyAction = assessWorkstreamAction,
    prepareCommunication,
    readCommunications,
    reportDelivery,
  } = options
  Id.parse(id)
  await store.initialize()
  const trigger = options.trigger ?? 'manual'
  const now = stamp(options.now)
  return withLock(
    path.join(store.stateDir, `${id}.run.lock`),
    async () => {
      let workstream = await store.get(id)
      if (!workstream) throw new WorkstreamError('This workstream could not be found.', 404)
      const grant = await store.getGrant(id)
      if (!['active', 'proposed'].includes(workstream.state))
        return nothing(id, now, trigger, `Sky is stopped while this workstream is ${workstream.state}.`)
      if (grant.mode === 'off' && trigger !== 'manual')
        return nothing(id, now, trigger, 'This workstream has no active standing responsibility.')
      if (trigger !== 'manual' && workstream.state !== 'active')
        return nothing(id, now, trigger, 'This workstream has no active standing responsibility.')

      if (reportDelivery) {
        await reportDelivery.reconcilePending(id)
        workstream = (await store.get(id))!
      }

      let runs = await store.runs(id)
      let recoveredDeliveryRun: WorkstreamRun | undefined
      if (reportDelivery) {
        for (const previous of runs.filter((entry) => entry.phase === 'awaiting_report' && !entry.deliveryId)) {
          const intent = ReportIntentSchema.safeParse(previous)
          if (!intent.success || !workstream.history.some((entry) => entry.operationId === previous.id)) continue
          try {
            const delivery = await reportDelivery.dispatch({
              workstreamId: id,
              reportingId: intent.data.reportingId,
              artifactId: intent.data.reportArtifactId,
              revision: workstream.revision,
              expectedGrantRevision: intent.data.reportGrantRevision,
              expectedSourceVersions: intent.data.reportSourceVersions,
              attachments: intent.data.reportAttachments,
              missingInputs: intent.data.reportMissingInputs,
            })
            recoveredDeliveryRun = {
              ...previous,
              status: 'completed',
              finished: now,
              deliveryId: delivery.id,
              outboxId: delivery.outboxId,
              summary:
                delivery.status === 'sent'
                  ? `Recovered the report delivery: ${delivery.receipt?.url ?? ''}`
                  : 'Recovered the prepared report and its pending delivery.',
              error: undefined,
            }
            await store.putRun(recoveredDeliveryRun)
          } catch (error) {
            await store.putRun({
              ...previous,
              status: 'completed',
              finished: now,
              summary: 'The report artifact was prepared; its delivery remains pending.',
              error: error instanceof Error ? error.message : 'The report delivery could not be recovered.',
            })
          }
          workstream = (await store.get(id))!
        }
        runs = await store.runs(id)
      }
      if (recoveredDeliveryRun && !request && !options.reportingId) {
        const sources = await sourcesFor(store, workstream)
        const artifacts = await artifactsFor(store, workstream)
        const records = await store.list()
        const communications = readCommunications ? await readCommunications(id) : []
        const currentGrant = await store.getGrant(id)
        await atomicWrite(
          path.join(store.stateDir, `${id}.review.json`),
          JSON.stringify({
            fingerprint: fingerprint(workstream, sources, currentGrant, records, now, artifacts, communications),
            checkedAt: now,
            nextCheckAt: workstream.sky.nextReviewAt ?? later(now, currentGrant.reviewEveryHours * 60),
            lastRunId: recoveredDeliveryRun.id,
          }),
        )
        return recoveredDeliveryRun
      }
      const recovered = await reconcile(store, workstream, runs, now)
      const latest = [...runs].sort(
        (a, b) => stamp(b.started).localeCompare(stamp(a.started)) || Number(b.sequence ?? 0) - Number(a.sequence ?? 0),
      )[0]
      if (trigger !== 'manual' && (recovered || latest?.status === 'interrupted')) {
        await attention(store, id, now, 'An interrupted attempt needs review before Sky continues.')
        return nothing(id, now, trigger, 'An interrupted attempt needs review before Sky continues.')
      }
      const attempted = runs.filter((run) => run.status !== 'nothing')
      const lifetimeLimitReached = grant.maxRunsTotal !== undefined && attempted.length >= grant.maxRunsTotal
      if (
        lifetimeLimitReached ||
        attempted.filter((run) => run.started.slice(0, 10) === now.slice(0, 10)).length >= grant.maxRunsPerDay
      ) {
        const message = lifetimeLimitReached
          ? 'Sky has reached the configured lifetime effort limit. Review its responsibility and limits to continue.'
          : 'Sky has reached today’s effort limit. Scheduled work can continue after the daily limit resets at 00:00 UTC.'
        await attention(store, id, now, message)
        return nothing(id, now, trigger, message)
      }

      const sources = await sourcesFor(store, workstream)
      const previousArtifacts = await artifactsFor(store, workstream)
      const communications = readCommunications ? await readCommunications(id) : []
      const records = await store.list()
      const inputFingerprint = fingerprint(workstream, sources, grant, records, now, previousArtifacts, communications)
      const stateFile = path.join(store.stateDir, `${id}.review.json`)
      const saved = await readOptional(stateFile)
      const checkpoint = saved ? CheckpointSchema.parse(JSON.parse(saved)) : null
      const reporting = options.reportingId
        ? workstream.reporting.find((policy) => policy.id === options.reportingId)
        : request
          ? undefined
          : workstream.reporting.find((policy) => due(policy.nextDueAt, now))
      if (options.reportingId && !reporting) throw new WorkstreamError('This reporting audience no longer exists.', 404)
      if (
        trigger !== 'manual' &&
        checkpoint &&
        checkpoint.fingerprint === inputFingerprint &&
        !due(checkpoint.nextCheckAt, now) &&
        (!reporting || latest?.status === 'failed')
      )
        return nothing(id, now, trigger, 'No new selected context or scheduled review is due.')

      let run: WorkstreamRun = {
        id: randomUUID(),
        workstreamId: id,
        status: 'running',
        trigger,
        started: now,
        sequence: Math.max(0, ...runs.map((previous) => Number(previous.sequence ?? 0))) + 1,
        summary: reporting
          ? 'Preparing the next audience update.'
          : 'Reviewing current work and preparing the next useful move.',
        artifactIds: [],
        inputRevision: workstream.revision,
        grantRevision: grant.revision,
        fingerprint: inputFingerprint,
      }
      await store.putRun(run)
      const signal = AbortSignal.timeout(75_000)
      try {
        const eligibleActivityIds = eligible(workstream, records, {
          grant,
          allowRecheck: trigger === 'manual' || Boolean(checkpoint && checkpoint.fingerprint !== inputFingerprint),
        })
        let next: Workstream
        let artifact: Artifact | undefined
        let content = ''
        let summary = ''
        let communication: WorkstreamReview['communication'] = null
        let actionVerification: ActionVerification | undefined
        let actionNeedsRevision = false
        let reportGrant: ReportDeliveryGrant | undefined
        let reportSourceVersions: Record<string, string> | undefined
        let reportMissingInputs: string[] = []
        let reportObservedSources: SourceSnapshot[] | undefined
        let nextCheckMinutes = grant.reviewEveryHours * 60
        if (reporting) {
          if (reportDelivery && ['email', 'slack'].includes(reporting.medium)) {
            reportGrant = await reportDelivery.grant(id, reporting.id)
            reportSourceVersions = await reportDelivery.sourceVersions(workstream, reporting)
          }
          const allowed = new Set(reporting.permittedSourceIds)
          // Do not pass the brief, decisions, history, metrics or general agent context to an audience report.
          // Those may themselves contain information copied from an excluded source.
          const selectedSources = workstream.sources.filter(
            (source) => allowed.has(source.id) && (!source.sensitive || reporting.allowSensitive === true),
          )
          const permitted = (await sourcesFor(store, { ...workstream, sources: selectedSources })).map((source) =>
            reportingSource(source, workstream),
          )
          reportObservedSources = permitted
          const proposal = WorkstreamReportSchema.parse(
            await report({ now, title: workstream.title, reporting, sources: permitted }, signal),
          )
          reportMissingInputs = [
            ...new Set([
              ...proposal.missingInputs,
              ...selectedSources
                .filter((source) => !permitted.some((entry) => entry.id === source.id))
                .map((source) => `Selected source ${source.label || source.path} exceeded the report's context limit.`),
              ...permitted
                .filter((source) => source.error || source.truncated || !source.content.trim())
                .map((source) => `Selected source ${source.label || source.path} is unavailable or incomplete.`),
              ...(permitted.some((source) => !source.error && source.content.trim())
                ? []
                : ['No readable audience-permitted context was supplied.']),
            ]),
          ]
          summary = `Prepared an update for ${reporting.audience}. It needs review${reportMissingInputs.length ? `; missing inputs: ${reportMissingInputs.join('; ')}` : ''}.`
          content = `${proposal.body}\n${reportMissingInputs.length ? `\n## Inputs still needed\n\n${reportMissingInputs.map((input) => `- ${input}`).join('\n')}\n` : ''}`
          artifact = {
            id: run.id,
            title: proposal.title,
            path: path.join(path.dirname(workstream.path), 'artifacts', `${run.id}.md`),
            created: now,
            reportingId: reporting.id,
            kind: 'report',
          }
          next = structuredClone(workstream)
          next.reporting = next.reporting.map((policy) =>
            policy.id === reporting.id
              ? {
                  ...policy,
                  lastPreparedAt: now,
                  nextDueAt:
                    options.reportingId && policy.nextDueAt && !due(policy.nextDueAt, now)
                      ? policy.nextDueAt
                      : later(now, policy.cadenceDays * 1440),
                }
              : policy,
          )
        } else {
          const proposal = WorkstreamReviewSchema.parse(
            await propose(
              {
                now,
                request: request ?? '',
                workstream,
                sources: sources.map((source) => reportingSource(source, workstream)),
                previousArtifacts,
                communications,
                omittedSources: Math.max(0, workstream.sources.length - sources.length),
                authority: { ...grant, mode: grant.mode === 'off' ? 'assist' : grant.mode },
                eligibleActivityIds,
                communicationPreparation: Boolean(prepareCommunication),
                relatedWork: relatedContext(workstream, records),
                existingWorkstreams: records
                  .filter((record) => record.id !== id)
                  .slice(0, 100)
                  .map((record) => ({
                    id: record.id,
                    title: record.title,
                    outcome: record.outcome,
                    parentId: record.parentId,
                    state: record.state,
                    relations: record.relations,
                    activities: record.activities.slice(0, 12).map(({ id, title, outcome, state, result }) => ({
                      id,
                      title,
                      outcome,
                      state,
                      result,
                    })),
                    omittedActivities: Math.max(0, record.activities.length - 12),
                  })),
                previousRun: latest ?? null,
              },
              signal,
            ),
          )
          next = applyReview(workstream, proposal, grant.mode === 'off' ? 'assist' : grant.mode)
          summary =
            proposal.decisionAssessments?.length || proposal.artifact || proposal.communication
              ? 'Reviewed the current work.'
              : proposal.summary
          for (const assessment of proposal.decisionAssessments ?? []) {
            const activity = workstream.activities.find((candidate) => candidate.id === assessment.activityId)
            if (!activity) throw new WorkstreamError('Sky assessed a decision that does not exist.')
            const evaluation = evaluateDecision({
              activity,
              policy: grant.decisionPolicies[activity.id],
              policyRevision: grant.revision,
              assessment,
              sources: sources.map((source) => reportingSource(source, workstream)),
              stakeholders: workstream.stakeholders,
              now,
              runId: run.id,
              prerequisitesSatisfied: activity.requires.every((requirement) => {
                const required = records
                  .find((record) => record.id === requirement.workstreamId)
                  ?.activities.find((candidate) => candidate.id === requirement.activityId)
                return required?.subworkstreamId
                  ? records.some((record) => record.id === required.subworkstreamId && record.state === 'completed')
                  : required?.state === 'done'
              }),
            })
            next.activities = next.activities.map((candidate) =>
              candidate.id === activity.id ? applyDecisionEvaluation(candidate, evaluation) : candidate,
            )
            if (evaluation.record) {
              const decisionSummary =
                evaluation.action === 'resolve'
                  ? `Sky decided “${activity.title}”: ${evaluation.record.choiceLabel}.`
                  : evaluation.action === 'escalate'
                    ? `“${activity.title}” needs your judgment: ${evaluation.reasons.join(' ')}`
                    : `Sky prepared a recommendation for “${activity.title}”.`
              summary += `\n${decisionSummary}`
              next.history.push({
                id: randomUUID(),
                at: now,
                actor: 'sky',
                kind: 'decision',
                activityId: activity.id,
                summary: decisionSummary,
                operationId: run.id,
              })
            }
          }
          nextCheckMinutes = Math.min(grant.reviewEveryHours * 60, Math.max(15, proposal.nextCheckMinutes))
          if (
            grant.mode === 'drive' &&
            next.activities.some(
              (activity) =>
                activity.executor === 'sky' &&
                activity.state === 'ready' &&
                !workstream.activities.some((prior) => prior.id === activity.id),
            )
          )
            nextCheckMinutes = Math.min(nextCheckMinutes, 15)
          if (proposal.waitingFor) next.sky.waitingFor = proposal.waitingFor
          else delete next.sky.waitingFor
          const validIds = new Set(records.map((record) => record.id))
          if (
            proposal.relationships.some(
              (relation) => !validIds.has(relation.workstreamId) || relation.workstreamId === id,
            )
          )
            throw new WorkstreamError('Sky proposed a relationship to an unavailable workstream.')
          if (proposal.artifact && proposal.communication)
            throw new WorkstreamError('Sky may prepare one artifact or one communication per review.')
          if (proposal.communication) {
            if (!prepareCommunication) throw new WorkstreamError('Outbox preparation is not available for this run.')
            if (!eligibleActivityIds.includes(proposal.communication.activityId))
              throw new WorkstreamError('The communication activity is not ready or assigned to Sky.')
            if (
              proposal.communication.sourceRef &&
              !sources.some((source) => source.path === proposal.communication?.sourceRef)
            )
              throw new WorkstreamError('The communication source must be explicitly linked to this workstream.')
            communication = proposal.communication
            next.activities = next.activities.map((activity) =>
              activity.id === communication?.activityId
                ? { ...activity, state: 'waiting', waitingFor: 'Owner review in Outbox.' }
                : activity,
            )
          }
          if (proposal.artifact) {
            if (proposal.artifact.activityId && !eligibleActivityIds.includes(proposal.artifact.activityId))
              throw new WorkstreamError('Sky selected an activity it is not authorized or ready to prepare.')
            const output = proposal.artifact
            const prior = previousArtifacts.find(
              (existing) =>
                !existing.truncated &&
                normalize(existing.title) === normalize(output.title) &&
                existing.content.trim() === output.body.trim(),
            )
            if (prior)
              summary = `Reviewed the workstream. The existing draft “${prior.title}” already contains this preparation.`
            else
              artifact = {
                id: run.id,
                title: proposal.artifact.title,
                path: path.join(path.dirname(workstream.path), 'artifacts', `${run.id}.md`),
                created: now,
                activityId: proposal.artifact.activityId || undefined,
                kind: 'draft',
              }
            content = proposal.artifact.body
            const activity = workstream.activities.find((candidate) => candidate.id === output.activityId)
            const policy = activity ? grant.actionPolicies[activity.id] : undefined
            if (artifact && !policy) summary += `\nPrepared “${artifact.title}” for your review.`
            if (artifact && activity && policy) {
              let assessment: ActionAssessment
              try {
                assessment = await verifyAction(
                  {
                    now,
                    activity: { title: activity.title, outcome: activity.outcome, notes: activity.notes },
                    successCriteria: policy.successCriteria,
                    requiredSourceIds: policy.requiredSourceIds,
                    artifact: { title: output.title, content },
                    sources: sources.map((source) => reportingSource(source, workstream)),
                  },
                  signal,
                )
              } catch (error) {
                signal.throwIfAborted()
                assessment = {
                  satisfied: false,
                  rationale: 'The independent check could not finish.',
                  artifactEvidence: [],
                  sourceEvidence: [],
                  requiresExternalResult: false,
                  missingInputs: [error instanceof Error ? error.message : 'The independent check is unavailable.'],
                }
              }
              actionVerification = verifyActionArtifact({
                activity,
                policy,
                assessment,
                content,
                sources: sources.map((source) => reportingSource(source, workstream)),
                runId: run.id,
                now,
                policyRevision: grant.revision,
              })
              actionNeedsRevision =
                actionVerification.outcome === 'needs_review' &&
                !actionVerification.satisfied &&
                !actionVerification.requiresExternalResult &&
                actionVerification.missingInputs.length === 0 &&
                actionVerification.reasons.length === 1 &&
                actionVerification.reasons[0] ===
                  'The prepared deliverable does not yet meet the agreed success criteria.'
              summary +=
                actionVerification.outcome === 'accepted'
                  ? `\nCompleted the agreed deliverable: ${activity.title}.`
                  : actionNeedsRevision
                    ? `\nSky will revise the deliverable against the agreed success criteria: ${activity.title}.`
                    : `\nThe deliverable needs review: ${actionVerification.reasons.join(' ')}`
            }
          }
        }
        signal.throwIfAborted()
        const fresh = await store.get(id)
        const freshGrant = await store.getGrant(id)
        if (
          !fresh ||
          fresh.revision !== workstream.revision ||
          freshGrant.revision !== grant.revision ||
          !['active', 'proposed'].includes(fresh.state)
        )
          throw new WorkstreamError(
            'Work or Sky responsibility changed while preparing this result. The obsolete proposal was not applied.',
            409,
          )
        const freshSources = await sourcesFor(store, fresh)
        if (reporting && reportObservedSources) {
          const refreshed = (
            await sourcesFor(store, {
              ...fresh,
              sources: fresh.sources.filter(
                (source) =>
                  reporting.permittedSourceIds.includes(source.id) && (!source.sensitive || reporting.allowSensitive),
              ),
            })
          ).map((source) => reportingSource(source, fresh))
          const versions = (values: SourceSnapshot[]) =>
            JSON.stringify(values.map(({ id, version }) => ({ id, version })))
          if (versions(refreshed) !== versions(reportObservedSources))
            throw new WorkstreamError(
              'The audience context changed while Sky prepared this report. The obsolete report was not applied.',
              409,
            )
        }
        const freshRecords = await store.list()
        const freshArtifacts = await artifactsFor(store, fresh)
        const freshCommunications = readCommunications ? await readCommunications(id) : []
        if (
          fingerprint(fresh, freshSources, freshGrant, freshRecords, now, freshArtifacts, freshCommunications) !==
          inputFingerprint
        )
          throw new WorkstreamError(
            'Selected context or related work changed while Sky was working. The obsolete proposal was not applied.',
            409,
          )
        if (artifact) {
          run = {
            ...run,
            artifactIds: [artifact.id],
            summary: 'Preparing one local artifact; no external action is authorized.',
          }
          await store.putRun(run)
          signal.throwIfAborted()
          next.artifacts.push(artifact)
          if (artifact.activityId) {
            // A failed quality check can be revised with the same inputs. Evidence failures need new context.
            const reviseNow = actionNeedsRevision
            next.activities = next.activities.map((activity) =>
              activity.id === artifact.activityId
                ? {
                    ...activity,
                    artifactIds: [...activity.artifactIds, artifact.id],
                    result:
                      actionVerification?.outcome === 'accepted'
                        ? `Completed agreed deliverable: ${artifact.title}. ${actionVerification.rationale}`
                        : reviseNow
                          ? `Prepared local draft: ${artifact.title}. Sky will revise it against the agreed success criteria.`
                          : `Prepared local draft: ${artifact.title}. Review is still needed.`,
                    state: actionVerification?.outcome === 'accepted' ? 'done' : reviseNow ? 'ready' : 'waiting',
                    waitingFor:
                      actionVerification?.outcome === 'accepted'
                        ? ''
                        : reviseNow
                          ? ''
                          : actionVerification?.reasons.join(' ') || 'Owner review of the prepared draft.',
                    ...(actionVerification ? { actionVerification } : {}),
                  }
                : activity,
            )
          }
        }
        if (
          eligible(
            next as WorkstreamRecord,
            records.map((record) =>
              record.id === next.id ? { ...next, path: record.path, revision: record.revision } : record,
            ),
          ).length
        )
          nextCheckMinutes = Math.min(nextCheckMinutes, 15)
        next.sky = {
          ...next.sky,
          lastReviewedAt: now,
          nextReviewAt: later(now, nextCheckMinutes),
          lastSummary: summary,
        }
        delete next.sky.error
        next.updated = now
        next.history.push({
          id: randomUUID(),
          at: now,
          actor: 'sky',
          kind: artifact ? 'prepared' : 'reviewed',
          summary,
          operationId: run.id,
        })
        // This short CAS is the commit boundary. Model work never holds the document's writer lock.
        run = {
          ...run,
          phase: communication ? 'awaiting_outbox' : reportGrant ? 'awaiting_report' : 'committing',
          communicationActivityId: communication?.activityId,
          ...(reportGrant && artifact && reporting
            ? {
                reportArtifactId: artifact.id,
                reportingId: reporting.id,
                reportSourceVersions,
                reportGrantRevision: reportGrant.revision,
                reportMissingInputs,
                reportAttachments: reporting.attachments ?? [],
              }
            : {}),
        }
        await store.putRun(run)
        let committed = await store.commitRunEffect(
          next,
          workstream.revision,
          grant.revision,
          artifact,
          content,
          trigger === 'manual',
        )
        if (communication && prepareCommunication) {
          signal.throwIfAborted()
          const prepared = await prepareCommunication({
            workstreamId: id,
            activityId: communication.activityId,
            revision: committed.revision,
            expectedGrantRevision: grant.revision,
            allowManual: trigger === 'manual',
            actor: 'sky',
            intentId: `activity-${communication.activityId}`,
            sourceIds: sources.filter((source) => source.version !== 'workstream-context').map((source) => source.id),
            expectedSourceVersions: Object.fromEntries(
              sources
                .filter((source) => source.version !== 'workstream-context')
                .map((source) => [source.id, source.version]),
            ),
            sourceRef: communication.sourceRef || undefined,
            title: communication.title,
            draft: communication.draft,
            medium: communication.medium,
            destination: communication.destination || undefined,
          })
          committed = prepared.workstream
          summary = `${summary}\nPrepared a communication in Outbox for review. It has not been sent.`
          run.outboxId = prepared.item.id
        }
        if (reporting && artifact && reportDelivery && reportGrant) {
          const delivery = await reportDelivery.dispatch({
            workstreamId: id,
            reportingId: reporting.id,
            artifactId: artifact.id,
            revision: committed.revision,
            expectedGrantRevision: reportGrant.revision,
            expectedSourceVersions: reportSourceVersions,
            attachments: reporting.attachments,
            missingInputs: reportMissingInputs,
          })
          committed = (await store.get(id))!
          summary =
            delivery.status === 'sent'
              ? `Delivered the update for ${reporting.audience}. ${delivery.receipt?.url ?? ''}`
              : delivery.status === 'unknown' || delivery.status === 'sending'
                ? `The update for ${reporting.audience} has an unconfirmed delivery. Sky will reconcile the provider receipt before another attempt.`
                : `Prepared the update for ${reporting.audience}. ${delivery.error ?? (delivery.blockers.join(' ') || 'It is ready for delivery review.')}`
          run.deliveryId = delivery.id
          run.outboxId = delivery.outboxId
          const updated = {
            ...committed,
            sky: {
              ...committed.sky,
              lastSummary: summary,
              ...(['failed', 'unknown'].includes(delivery.status) ? { error: summary } : {}),
            },
          }
          committed = await store.put(updated, committed.revision)
        }
        run = { ...run, status: 'completed', finished: now, summary, artifactIds: artifact ? [artifact.id] : [] }
        await store.putRun(run)
        const savedArtifact = artifact ? await store.readArtifact(id, artifact.id) : null
        const committedArtifacts = savedArtifact
          ? [
              {
                id: savedArtifact.artifact.id,
                title: savedArtifact.artifact.title,
                version: hash(savedArtifact.content),
                content: savedArtifact.content,
                truncated: false,
              },
              ...freshArtifacts,
            ].slice(0, 6)
          : freshArtifacts
        const committedCommunications = [...freshCommunications]
        if (communication && readCommunications && !committedCommunications.some((item) => item.id === run.outboxId)) {
          const prepared = (await readCommunications(id)).find((item) => item.id === run.outboxId)
          if (prepared) committedCommunications.push(prepared)
        }
        await atomicWrite(
          stateFile,
          JSON.stringify({
            fingerprint: fingerprint(
              committed,
              freshSources,
              freshGrant,
              freshRecords,
              now,
              committedArtifacts,
              committedCommunications,
            ),
            checkedAt: now,
            nextCheckAt: next.sky.nextReviewAt,
            lastRunId: run.id,
          }),
        )
        return run
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const current = await store.get(id)
        const applied =
          current?.history.some((entry) => entry.operationId === run.id) &&
          (run.phase !== 'awaiting_outbox' ||
            current.activities.some((activity) => activity.id === run.communicationActivityId && activity.outboxId))
        run = {
          ...run,
          status: applied
            ? 'completed'
            : run.artifactIds.length || run.phase === 'awaiting_outbox'
              ? 'interrupted'
              : 'failed',
          finished: now,
          summary: applied
            ? 'The workstream result was recorded; later bookkeeping needs reconciliation.'
            : 'Sky could not complete this attempt.',
          error: message,
        }
        await store.putRun(run)
        // A failure backs off; an owner/source edit still wakes the next pass immediately.
        if (run.status === 'interrupted' && run.phase === 'awaiting_outbox' && current) {
          const activity = current.activities.find((candidate) => candidate.id === run.communicationActivityId)
          if (
            activity &&
            !activity.outboxId &&
            activity.state === 'waiting' &&
            activity.waitingFor === 'Owner review in Outbox.'
          ) {
            await store
              .put(
                {
                  ...current,
                  activities: current.activities.map((candidate) =>
                    candidate.id === activity.id
                      ? {
                          ...candidate,
                          state: 'ready',
                          waitingFor:
                            'Review the interrupted attempt before retrying this same local communication intent.',
                        }
                      : candidate,
                  ),
                },
                current.revision,
              )
              .catch(() => {})
          }
        }
        if (run.status === 'failed' || run.status === 'interrupted')
          await attention(store, id, now, `${run.summary} ${message}`)
        await atomicWrite(
          stateFile,
          JSON.stringify({
            fingerprint: inputFingerprint,
            checkedAt: now,
            nextCheckAt: later(now, Math.max(60, grant.reviewEveryHours * 60)),
            lastRunId: run.id,
          }),
        )
        return run
      }
    },
    false,
  ).catch(async (error: unknown) => {
    if ((error as { status?: number }).status === 409 && !(error instanceof WorkstreamError))
      return nothing(id, now, trigger, 'Sky is already working on this workstream.')
    await attention(
      store,
      id,
      now,
      `Sky could not check this workstream. ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  })
}

export async function scanWorkstreams(
  options: Omit<RunWorkstreamOptions, 'id' | 'trigger' | 'request'> & { limit?: number },
): Promise<WorkstreamScanReport> {
  const result: WorkstreamScanReport = {
    outcome: 'nothing',
    considered: 0,
    reviewed: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  }
  const inventory = await options.store.report()
  for (const error of inventory.errors) result.errors.push({ id: error.path, message: error.message })
  result.failed = inventory.errors.length
  let attempted = 0
  for (const workstream of inventory.items) {
    if (attempted >= (options.limit ?? 3)) break
    result.considered++
    try {
      const run = await runWorkstream({ ...options, id: workstream.id, trigger: 'scheduled' })
      if (run.status === 'completed') {
        result.reviewed++
        attempted++
      } else if (run.status === 'nothing') result.skipped++
      else {
        result.failed++
        attempted++
        result.errors.push({ id: workstream.id, message: run.error ?? run.summary })
      }
    } catch (error) {
      result.failed++
      attempted++
      result.errors.push({ id: workstream.id, message: error instanceof Error ? error.message : String(error) })
    }
  }
  result.outcome = result.failed ? 'failed' : result.reviewed ? 'acted' : 'nothing'
  return result
}
