import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { hash, readOptional, withLock } from '#lib/outbox/files.ts'
import type { SavedMessages } from '#lib/outbox/sources.ts'
import type { OutboxStore } from '#lib/outbox/store.ts'
import {
  MAX_OUTBOX_DRAFT_CHARS,
  OutboxError,
  type Conversation,
  type OutboxItem,
  type OutboxRecord,
  type WorkstreamLink,
} from '#lib/outbox/types.ts'
import type { VoiceWriter } from '#lib/writingVoice/types.ts'
import { toTimeRef } from '#shared/nbfs/timeRef.ts'
import type { WorkstreamStore } from './store.ts'
import { WorkstreamError, type WorkstreamRecord } from './types.ts'

export type WorkstreamOutboxOptions = {
  workstreams: WorkstreamStore
  store: OutboxStore
  sources: SavedMessages
  now: () => string
  writeVoice?: VoiceWriter
}

export type PrepareWorkstreamCommunication = {
  workstreamId: string
  activityId: string
  revision: string
  intentId?: string
  decisionIds?: string[]
  sourceIds?: string[]
  sourceRef?: string
  title: string
  draft: string
  medium: 'Email' | 'Slack'
  destination?: string
  actor?: 'human' | 'sky'
  expectedGrantRevision?: string
  expectedSourceVersions?: Record<string, string>
  expectedConversationVersion?: string
  /** The trusted manual runner can use a single invocation while standing responsibility is off. */
  allowManual?: boolean
}

export type WorkstreamCommunicationSnapshot = {
  id: string
  activityIds: string[]
  title: string
  status: OutboxRecord['status']
  stale: boolean
  native: OutboxRecord['native']
  delivery: OutboxRecord['delivery'] | null
  placementError: string | null
  sourceVersion: string
  draftVersion: string
  version: string
  sources: { ref: string; from: string; to: string; body: string; changedSinceRequest: boolean; truncated: boolean }[]
  error?: string
}

/** A digest of relevant content, excluding camera layout, unrelated activities and review bookkeeping. */
export async function workstreamOutboxContext(
  store: WorkstreamStore,
  links: WorkstreamLink[],
): Promise<WorkstreamLink[]> {
  return Promise.all(
    links.map(async (link) => {
      const record = await store.get(link.workstreamId)
      if (!record) throw new OutboxError('A linked workstream is missing. Repair the link before approving.', 409)
      const activity = record.activities.find((item) => item.id === link.activityId)
      if (link.activityId && !activity)
        throw new OutboxError('A linked activity is missing. Repair the link before approving.', 409)
      const decisions = link.decisionIds.map((id) => {
        const decision = record.activities.find((item) => item.id === id && item.kind === 'decision')
        if (!decision) throw new OutboxError('A linked decision is missing. Repair the link before approving.', 409)
        return {
          id,
          title: decision.title,
          state: decision.state,
          result: decision.result,
          recommendation: decision.recommendation,
        }
      })
      const sources = await Promise.all(
        (link.sourceIds ?? []).map(async (id) => {
          const source = record.sources.find((item) => item.id === id)
          if (!source) throw new OutboxError('A selected source is no longer linked to this workstream.', 409)
          const file = await store.resolveFile(source.path)
          const text = await readOptional(file)
          if (text === undefined || text.length > 160_000)
            throw new OutboxError('A selected source could not be checked.', 409)
          return { id, path: source.path, version: hash(text) }
        }),
      )
      const snapshot = JSON.stringify(
        {
          title: record.title,
          outcome: record.outcome,
          understanding: record.understanding,
          notes: record.notes,
          stakeholders: record.stakeholders,
          metrics: record.metrics,
          otherActivities: link.fullContext
            ? record.activities.map(({ id, title, kind, outcome, state, notes, result, recommendation, requires }) => ({
                id,
                title,
                kind,
                outcome,
                state,
                notes,
                result,
                recommendation,
                requires,
              }))
            : undefined,
          activity: activity
            ? {
                id: activity.id,
                title: activity.title,
                outcome: activity.outcome,
                notes: activity.notes,
                state: activity.state,
                result: activity.result,
              }
            : undefined,
          decisions,
          sources,
        },
        null,
        2,
      )
      const context = [
        record.outcome ? `Desired outcome: ${record.outcome}` : 'The desired outcome is still taking shape.',
        record.understanding,
        record.notes,
        activity
          ? `Activity: ${activity.title}\n${activity.outcome}\n${activity.notes}\n${activity.result ? `Recorded result: ${activity.result}` : ''}`
          : '',
        ...decisions.map(
          (decision) =>
            `Decision: ${decision.title}\n${decision.state === 'done' ? decision.result : `Pending. ${decision.recommendation}`}`,
        ),
        sources.length ? `Selected sources: ${sources.map((source) => source.path).join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
      return { ...link, title: record.title, context, contextVersion: hash(snapshot) }
    }),
  )
}

export function createWorkstreamOutbox(options: WorkstreamOutboxOptions) {
  const { workstreams, store, sources, now } = options
  const currentContext = (links: WorkstreamLink[]) => workstreamOutboxContext(workstreams, links)

  /** Derive state from Outbox and its saved captures; never persist another communications queue. */
  async function list(workstreamId: string): Promise<WorkstreamCommunicationSnapshot[]> {
    const items = (await store.list())
      .filter((item) => item.workstreams?.some((link) => link.workstreamId === workstreamId))
      .slice(0, 20)
    let remaining = 48_000
    const snapshots: WorkstreamCommunicationSnapshot[] = []
    for (const item of items) {
      let conversation = item.conversation
      let error: string | undefined
      if (conversation.sources.length) {
        try {
          conversation = await sources.current(conversation)
        } catch (problem) {
          error = problem instanceof Error ? problem.message : 'The saved conversation could not be checked.'
        }
      }
      const captured = conversation.sources.slice(-3).map((source) => {
        const limit = Math.min(8000, remaining)
        const body = source.body.slice(0, limit)
        remaining -= body.length
        return {
          ref: source.ref,
          from: source.from,
          to: source.to,
          body,
          changedSinceRequest: !(item.requestSources ?? item.conversation.sources).some(
            (original) => original.ref === source.ref && original.hash === source.hash,
          ),
          truncated: body.length !== source.body.length,
        }
      })
      const facts = {
        id: item.id,
        activityIds: [
          ...new Set(
            (item.workstreams ?? [])
              .filter((link) => link.workstreamId === workstreamId)
              .flatMap((link) => (link.activityId ? [link.activityId] : [])),
          ),
        ],
        title: item.title,
        status: item.status,
        stale: item.stale,
        native: item.native,
        delivery: item.delivery ?? null,
        placementError: item.placementError,
        sourceVersion: conversation.version,
        draftVersion: hash(item.draft),
        ...(error ? { error } : {}),
      }
      snapshots.push({ ...facts, version: hash(JSON.stringify(facts)), sources: captured })
    }
    return snapshots
  }

  async function linkBack(
    id: string,
    activityId: string,
    item: OutboxRecord,
    actor: 'human' | 'sky' = 'human',
  ): Promise<WorkstreamRecord> {
    const record = await workstreams.get(id)
    if (!record) throw new WorkstreamError('No such workstream.', 404)
    const activity = record.activities.find((entry) => entry.id === activityId)
    if (!activity) throw new WorkstreamError('No such activity.', 404)
    if (activity.outboxId === item.id) return record
    return workstreams.put(
      {
        ...record,
        updated: now(),
        activities: record.activities.map((entry) =>
          entry.id === activityId ? { ...entry, outboxId: item.id } : entry,
        ),
        history: [
          ...record.history,
          {
            id: randomUUID(),
            at: now(),
            actor,
            kind: 'outbox_prepared',
            activityId,
            operationId: `outbox:${item.id}`,
            summary: 'Prepared a communication in Outbox for review. Sending is unconfirmed.',
          },
        ],
      },
      record.revision,
    )
  }

  async function prepare(
    input: PrepareWorkstreamCommunication,
  ): Promise<{ workstream: WorkstreamRecord; item: OutboxRecord }> {
    const record = await workstreams.get(input.workstreamId)
    if (!record) throw new WorkstreamError('No such workstream.', 404)
    if (!record.activities.some((activity) => activity.id === input.activityId))
      throw new WorkstreamError('No such activity.', 404)
    if (
      !input.title.trim() ||
      input.title.length > 200 ||
      !input.draft.trim() ||
      input.draft.length > MAX_OUTBOX_DRAFT_CHARS
    )
      throw new WorkstreamError('Provide a title and a draft under 40,000 characters.')
    const intent = `${record.id}:${input.activityId}:${input.intentId ?? 'communication'}`
    const records = await store.list()
    const retried = records.find((item) => item.intentIds?.includes(intent))
    if (retried) return { item: retried, workstream: await linkBack(record.id, input.activityId, retried, input.actor) }
    if (record.revision !== input.revision)
      throw new WorkstreamError('The work changed. Review it before preparing this communication.', 409)
    const initial: WorkstreamLink = {
      workstreamId: record.id,
      activityId: input.activityId,
      decisionIds:
        input.decisionIds ?? record.activities.filter((entry) => entry.kind === 'decision').map((entry) => entry.id),
      fullContext: input.actor === 'sky',
      sourceIds: input.sourceIds ?? [],
      title: record.title,
      context: '',
      contextVersion: '',
    }
    const [link] = await currentContext([initial])
    const queue = async (item: OutboxItem, revision: string | null) =>
      withLock(path.join(workstreams.stateDir, 'write.lock'), async () => {
        const latest = await workstreams.get(record.id)
        if (!latest || latest.revision !== input.revision)
          throw new WorkstreamError('The work changed before this draft could be queued.', 409)
        if (input.actor === 'sky') {
          const grant = await workstreams.getGrant(record.id)
          if (
            !input.expectedGrantRevision ||
            grant.revision !== input.expectedGrantRevision ||
            (grant.mode === 'off' && !input.allowManual)
          )
            throw new WorkstreamError('Sky’s responsibility changed before this draft could be queued.', 409)
          if (latest.state !== 'active')
            throw new WorkstreamError('Sky can prepare communications only for active work.', 409)
        }
        const [fresh] = await currentContext([link])
        if (fresh.contextVersion !== link.contextVersion)
          throw new WorkstreamError('A selected source changed during preparation.', 409)
        for (const [id, version] of Object.entries(input.expectedSourceVersions ?? {})) {
          const source = latest.sources.find((entry) => entry.id === id)
          if (!source || hash((await readOptional(await workstreams.resolveFile(source.path))) ?? '') !== version)
            throw new WorkstreamError('A source changed after Sky read it. The obsolete draft was not queued.', 409)
        }
        if (input.expectedConversationVersion && item.conversation.version !== input.expectedConversationVersion)
          throw new WorkstreamError('The saved conversation changed after Sky read it.', 409)
        if (
          item.conversation.sources.length &&
          (await sources.current(item.conversation)).version !== item.conversation.version
        )
          throw new WorkstreamError('New messages arrived while preparing the communication.', 409)
        return store.put(item, revision)
      })
    let conversation: Conversation
    if (input.sourceRef) {
      const found = await sources.conversation(toTimeRef(input.sourceRef))
      if (!found) throw new WorkstreamError('Choose a saved Slack or email conversation.')
      conversation = found
    } else {
      const destination = input.destination?.trim() ?? ''
      conversation = {
        key: `workstream:${intent}`,
        version: hash(JSON.stringify({ intent, destination, medium: input.medium })),
        medium: input.medium,
        sources: [],
        target: null,
        limitations: [
          destination ? `Intended destination: ${destination}.` : 'A recipient has not been selected.',
          'This is a workstream draft. Copy it into the intended app; no verified native conversation is linked.',
        ],
      }
    }
    const current = records.find((item) => item.conversation.key === conversation.key && item.status !== 'dismissed')
    let item: OutboxRecord
    if (current) {
      if (current.status === 'placing' || current.status === 'placement_unknown')
        throw new WorkstreamError('Resolve the existing native draft placement before attaching more work.', 409)
      const links = [...(current.workstreams ?? [])]
      if (!links.some((entry) => entry.workstreamId === link.workstreamId && entry.activityId === link.activityId))
        links.push(link)
      item = await queue(
        {
          ...current,
          workstreams: links,
          requestSources: current.requestSources ?? conversation.sources.map(({ ref, hash }) => ({ ref, hash })),
          intentIds: [...new Set([...(current.intentIds ?? []), intent])],
          updated: now(),
          stale:
            current.stale || current.conversation.version !== conversation.version || current.draft !== input.draft,
          conversation,
        },
        current.revision,
      )
    } else {
      const id = hash(conversation.key).slice(0, 32)
      const occupied = records.some((entry) => entry.id === id)
      const draft =
        input.actor === 'sky' && options.writeVoice
          ? (
              await options.writeVoice({
                meaning: input.draft,
                medium: input.medium,
                recipient: input.destination ?? '',
                context: input.title,
              })
            ).draft
          : input.draft.trim()
      item = await queue(
        {
          id: occupied ? hash(intent).slice(0, 32) : id,
          created: now(),
          updated: now(),
          status: 'needs_review',
          conversation,
          title: input.title.trim(),
          situation: `Prepared to advance ${record.title}.`,
          reasoning: 'Prepared from the linked workstream for your review. This has not been sent.',
          questions: [],
          originalDraft: draft,
          draft,
          edited: false,
          stale: false,
          reviews: [],
          native: null,
          placementError: null,
          workstreams: [link],
          intentIds: [intent],
          origin: 'workstream',
          requestSources: conversation.sources.map(({ ref, hash }) => ({ ref, hash })),
        },
        null,
      )
    }
    return { item, workstream: await linkBack(record.id, input.activityId, item, input.actor) }
  }

  async function reportSent(id: string, revision: string, evidence: string): Promise<OutboxRecord> {
    let item = await store.get(id)
    if (!item) throw new OutboxError('No such Outbox item.', 404)
    if (!item.workstreams?.length) throw new OutboxError('This draft is not linked to a workstream.')
    if (!evidence.trim() || evidence.length > 5000)
      throw new OutboxError('Describe where and when you sent this message.')
    if (item.status === 'placing' || item.status === 'placement_unknown')
      throw new OutboxError('Reconcile the native draft first.', 409)
    if (!item.delivery) {
      item = await store.put(
        {
          ...item,
          status: 'dismissed',
          delivery: { at: now(), evidence: evidence.trim(), kind: 'owner_report' },
          updated: now(),
        },
        revision,
        { requestAction: 'sent' },
      )
    }
    for (const link of item.workstreams ?? []) {
      if (!link.activityId) continue
      const record = await workstreams.get(link.workstreamId)
      if (!record) continue
      const operationId = `outbox-sent:${id}`
      if (record.history.some((entry) => entry.operationId === operationId && entry.activityId === link.activityId))
        continue
      await workstreams.put(
        {
          ...record,
          updated: now(),
          activities: record.activities.map((activity) =>
            activity.id === link.activityId
              ? {
                  ...activity,
                  state: activity.state === 'done' || activity.state === 'canceled' ? activity.state : 'waiting',
                  waitingFor: activity.waitingFor || 'A response or confirmation of the requested result.',
                  notes: `${activity.notes}${activity.notes ? '\n\n' : ''}Owner reported sending: ${item.delivery!.evidence}`,
                }
              : activity,
          ),
          history: [
            ...record.history,
            {
              id: randomUUID(),
              at: now(),
              actor: 'human',
              kind: 'communication_sent_report',
              activityId: link.activityId,
              operationId,
              summary: `Owner reported sending: ${item.delivery!.evidence}`,
            },
          ],
        },
        record.revision,
      )
    }
    return item
  }

  async function reportResponse(input: {
    workstreamId: string
    activityId: string
    revision: string
    sourceRef: string
    result: string
    accepted: boolean
  }): Promise<WorkstreamRecord> {
    const record = await workstreams.get(input.workstreamId)
    if (!record) throw new WorkstreamError('No such workstream.', 404)
    const activity = record.activities.find((entry) => entry.id === input.activityId)
    if (!activity?.outboxId) throw new WorkstreamError('This activity has no linked communication.')
    if (!input.result.trim() || input.result.length > 5000)
      throw new WorkstreamError('Describe the response and its implication for the work.')
    const item = await store.get(activity.outboxId)
    const responseRef = toTimeRef(input.sourceRef)
    const conversation = await sources.conversation(responseRef)
    if (!item || !conversation || !item.conversation.sources.length || conversation.key !== item.conversation.key)
      throw new WorkstreamError('The response must belong to the linked saved conversation.')
    const response = conversation.sources.find((source) => source.ref === responseRef)
    if (
      !response ||
      (item.requestSources ?? item.conversation.sources).some(
        (source) => source.ref === response.ref && source.hash === response.hash,
      )
    )
      throw new WorkstreamError('Choose a new or changed saved response, not the source used to draft the request.')
    const operationId = `outbox-response:${activity.outboxId}:${response.hash}`
    if (record.history.some((entry) => entry.operationId === operationId)) return record
    if (record.revision !== input.revision)
      throw new WorkstreamError('The work changed. Reload before recording the response.', 409)
    return workstreams.put(
      {
        ...record,
        updated: now(),
        activities: record.activities.map((entry) =>
          entry.id === activity.id
            ? {
                ...entry,
                state: input.accepted ? 'done' : 'ready',
                result: input.result.trim(),
                waitingFor: '',
                notes: `${entry.notes}${entry.notes ? '\n\n' : ''}Response evidence: ${input.sourceRef}`,
              }
            : entry,
        ),
        history: [
          ...record.history,
          {
            id: randomUUID(),
            at: now(),
            actor: 'human',
            kind: 'communication_response',
            activityId: activity.id,
            operationId,
            summary: `Owner assessed response (${input.sourceRef}): ${input.result.trim()}`,
          },
        ],
      },
      record.revision,
    )
  }

  return { prepare, currentContext, reportSent, reportResponse, list }
}
