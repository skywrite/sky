import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import process from 'node:process'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { AnalysisCache } from './analysisCache.ts'
import { atomicWrite, readOptional, withLock } from './files.ts'
import { newOutboxItemId } from './itemId.ts'
import { readScanProgress } from './progress.ts'
import { dayRange, rangeKey, ScanRangeSchema, type ScanRange } from './range.ts'
import { requestInRange, type RequestAnalyzer } from './requestAnalysis.ts'
import { requestNeedsReply, type RequestRecord } from './requestTypes.ts'
import { InventorySchema, type SavedMessages } from './sources.ts'
import type { OutboxStore } from './store.ts'
import {
  OutboxError,
  type Conversation,
  type DraftProposal,
  type Review,
  type OutboxRecord,
  type ScanCheck,
  type ScanProgress,
  type ScanReport,
} from './types.ts'

export type Propose = (input: {
  conversation: Conversation
  preferences: string
  examples: Review[]
  today: string
  now: string
  range?: ScanRange
  triggerSources?: string[]
  priorResponse?: Pick<OutboxRecord, 'status' | 'draft' | 'delivery' | 'responseHistory' | 'reviews'>
  requests?: RequestRecord[]
  requestCache?: AnalysisCache
}) => Promise<DraftProposal>

export async function scanOutbox(options: {
  store: OutboxStore
  sources: SavedMessages
  today: string
  now: string
  propose: Propose
  limit?: number
  concurrency?: number
  model?: string
  modelProfile?: string
  range?: ScanRange
  analyze?: RequestAnalyzer
  /** Notebook-local `YYYY-MM-DD HH:MM` that names new items. Defaults to the current local time. */
  localNow?: string
}): Promise<ScanReport> {
  const { store, sources, today, now, propose, limit = Infinity, concurrency = 4, model, modelProfile } = options
  // Read when an item is first written, so a long check names each item by its own minute.
  const localNow = () => options.localNow ?? new ZonedDateTime().plainDateTime.toString()
  const range = options.range ? ScanRangeSchema.parse(options.range) : dayRange(today)
  await store.initialize()
  const requestAnalysisVersion = await options.analyze?.version()
  return withLock(
    path.join(store.stateDir, 'scan.lock'),
    async () => {
      const previous = await readScanProgress(store)
      const report: ScanProgress = {
        id: randomUUID(),
        date: today,
        range,
        at: now,
        owner: process.pid,
        status: 'running',
        total: 0,
        completed: 0,
        unchanged: 0,
        checks: [],
        outcome: 'nothing',
        considered: 0,
        prepared: 0,
        ignored: 0,
        stale: 0,
        failed: 0,
        pending: 0,
        answered: 0,
        incomplete: 0,
      }
      const progressFile = path.join(store.stateDir, 'scan-progress.json')
      await atomicWrite(progressFile, JSON.stringify(report))
      try {
        const stateFile = path.join(store.stateDir, 'sources.json')
        const saved = await readOptional(stateFile)
        // A damaged checkpoint is an error, never permission to silently replay work.
        const prior = saved === undefined ? null : InventorySchema.parse(JSON.parse(saved))
        const state = await sources.discover(prior, range)
        const preferences = (await store.preferences()).text
        const examples = (await store.list())
          .flatMap((item) => item.reviews)
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, 12)
        // New items are named one at a time so parallel checks never claim the same name.
        const reserved = new Set<string>()
        let allocating: Promise<unknown> = Promise.resolve()
        const allocate = (title: string): Promise<string> => {
          const next = allocating.then(() =>
            newOutboxItemId({
              at: localNow(),
              title,
              taken: async (id) => reserved.has(id.toLowerCase()) || store.taken(id),
            }),
          )
          allocating = next.then(
            (id) => reserved.add(id.toLowerCase()),
            () => {},
          )
          return next
        }
        const checks = new Map(
          (previous?.range && rangeKey(previous.range) === rangeKey(range) ? previous.checks : []).map((check) => [
            check.key,
            check,
          ]),
        )
        type Candidate = { key: string; refs: string[]; conversation?: Conversation; error?: string }
        const candidates = new Map<string, Candidate>()
        for (const ref of state.pending) {
          try {
            const conversation = await sources.conversation(ref)
            if (!conversation) {
              state.pending = state.pending.filter((value) => value !== ref)
              continue
            }
            const existing = candidates.get(conversation.key)
            if (existing) existing.refs.push(ref)
            else candidates.set(conversation.key, { key: conversation.key, refs: [ref], conversation })
          } catch (error) {
            candidates.set(ref, {
              key: ref,
              refs: [ref],
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        const queued = [...candidates.values()]
        report.total = queued.length

        // Retire untouched items admitted today by the legacy date filter. Previously
        // reviewed decisions and workstream communications keep their carry-over behavior.
        if (prior && !prior.policy) {
          for (const item of await store.list()) {
            if (
              item.status === 'needs_review' &&
              item.created.startsWith(today) &&
              !item.edited &&
              !item.native &&
              !item.reviews.length &&
              !item.workstreams?.length &&
              item.origin !== 'workstream' &&
              item.conversation.sources.length &&
              item.conversation.sources.every((source) => source.ref.slice(0, 10) < today)
            ) {
              await store.put({ ...item, status: 'dismissed', updated: now }, item.revision)
            }
          }
        }

        // Model calls finish independently; write their checkpoints in order.
        let writes = Promise.resolve()
        const persist = () => {
          report.pending =
            report.total -
            report.completed +
            report.checks.filter((check) => check.disposition === 'failed' || check.limitations?.length).length
          const stateText = JSON.stringify(state)
          const progressText = JSON.stringify(report)
          writes = writes.then(async () => {
            await atomicWrite(stateFile, stateText)
            await atomicWrite(progressFile, progressText)
          })
          return writes
        }
        await persist()
        const examine = async (candidate: Candidate) => {
          const { key, refs, conversation } = candidate
          let check: ScanCheck = {
            key,
            refs,
            version: conversation?.version ?? '',
            medium: conversation?.medium,
            title:
              conversation?.sources
                .at(-1)
                ?.body.split('\n')
                .find((line) => line.trim())
                ?.replace(/^#+\s*/, '')
                .slice(0, 160) ?? 'Saved conversation',
            reason: '',
            disposition: 'failed',
            model,
            modelProfile,
            rangeKey: rangeKey(range),
          }
          try {
            if (!conversation) throw new Error(candidate.error ?? 'The saved conversation could not be read.')
            // An existing item keeps its id, whatever its shape. A new item is named when first written.
            const current = await store.byConversation(key)
            let id = current?.id
            const uncertainTime = refs.some(
              (ref) =>
                !state.entries?.[ref]?.times.length &&
                (range.start > `${ref.slice(0, 10)}T00:00` || range.end < `${ref.slice(0, 10)}T23:59`),
            )
            const limitations = [
              ...(conversation.incomplete ? conversation.limitations : []),
              ...(uncertainTime
                ? [
                    'A capture has no message timestamp. It is included for review because its time within the selected dates is uncertain.',
                  ]
                : []),
            ]
            if (limitations.length) {
              report.incomplete!++
              check.limitations = limitations
            }
            const known = checks.get(key)
            if (
              state.handled[key] === conversation.version &&
              known?.version === conversation.version &&
              known.disposition !== 'failed' &&
              !conversation.incomplete &&
              !known.limitations?.length &&
              known.itemRevision === current?.revision &&
              (model === undefined || known.model === model) &&
              (modelProfile === undefined || known.modelProfile === modelProfile) &&
              (!options.analyze || known.requestAnalysisVersion === requestAnalysisVersion)
            ) {
              check = { ...known, refs }
              report.unchanged!++
            } else {
              report.considered++
              if (current?.status === 'placing' || current?.status === 'placement_unknown') {
                throw new OutboxError(
                  'Check the earlier draft placement in the native app before reviewing this conversation again.',
                  409,
                )
              }
              const protectedItem =
                current &&
                (current.edited ||
                  current.native ||
                  current.reviews.length ||
                  current.workstreams?.length ||
                  (current.status === 'dismissed' && current.conversation.version === conversation.version))
              if (
                current &&
                protectedItem &&
                !options.analyze &&
                current.conversation.version === conversation.version &&
                (known?.rangeKey === rangeKey(range) ||
                  (current.reviewRange && rangeKey(current.reviewRange) === rangeKey(range)))
              ) {
                check = {
                  ...check,
                  itemId: id,
                  title: current.title,
                  disposition:
                    current.delivery || current.responseHistory?.at(-1)?.sourceVersion === conversation.version
                      ? 'answered'
                      : 'preserved',
                  reason: current.delivery
                    ? `You recorded this reply as sent: ${current.delivery.evidence}`
                    : current.status === 'dismissed'
                      ? 'You dismissed this conversation.'
                      : 'Your existing review or draft is preserved; new context is flagged for review.',
                }
                if (check.disposition === 'answered') report.answered!++
              } else {
                const analysis = await options.analyze?.analyze({ conversation, prior: current, now })
                const carried = new Set(current && current.status !== 'dismissed' ? (current.requestIds ?? []) : [])
                const requests = analysis?.requests.filter(
                  (request) => requestInRange(request, range) || (request.present && carried.has(request.id)),
                )
                const requestIds = requests?.filter(requestNeedsReply).map(({ id }) => id)
                const requestCache = analysis ? new AnalysisCache(store.stateDir, key) : undefined
                if (analysis) {
                  if ((await sources.current(conversation)).version !== conversation.version)
                    throw new OutboxError(
                      'Messages changed during request analysis. Check again to review the latest version.',
                      409,
                    )
                  // A completed reading survives a later drafting failure. Human decisions remain authoritative in the item.
                  await atomicWrite(
                    path.join(requestCache!.dir, 'completed.json'),
                    JSON.stringify({ ...analysis, itemRevision: current?.revision ?? null }),
                  )
                }
                let proposal = await propose({
                  conversation: limitations.length
                    ? { ...conversation, limitations: [...new Set([...conversation.limitations, ...limitations])] }
                    : conversation,
                  preferences,
                  examples,
                  today,
                  now,
                  range,
                  triggerSources: refs,
                  priorResponse: current
                    ? {
                        status: current.status,
                        draft: current.draft,
                        delivery: current.delivery,
                        responseHistory: current.responseHistory,
                        reviews: current.reviews.slice(-4),
                      }
                    : undefined,
                  requests,
                  requestCache,
                })
                if (requestIds?.length) {
                  const planned = proposal.requestPlans?.map(({ id }) => id) ?? []
                  if (
                    proposal.action === 'ignore' ||
                    planned.length !== requestIds.length ||
                    new Set(planned).size !== planned.length ||
                    requestIds.some((id) => !planned.includes(id))
                  )
                    throw new Error(
                      'The proposed reply did not account for every selected request. Check again to finish it.',
                    )
                  if (
                    proposal.action === 'draft' &&
                    proposal.requestPlans!.some(({ response }) => response.action !== 'draft' || !response.draft.trim())
                  )
                    throw new Error(
                      'A request still needs an owner decision before the complete reply can be prepared.',
                    )
                }
                const accounting = analysis
                  ? {
                      requests: analysis.requests.map((request) => ({
                        ...request,
                        response: proposal.requestPlans?.find(({ id }) => id === request.id)?.response,
                      })),
                      requestIds,
                      requestAnalysis: analysis.stamp,
                    }
                  : {}
                const fresh = await sources.current(conversation)
                if (fresh.version !== conversation.version)
                  throw new OutboxError(
                    'Messages changed during this check. Check again to review the latest version.',
                    409,
                  )
                // Missing capture history belongs in scan coverage; it cannot establish an obligation for the owner.
                if (limitations.length && proposal.action === 'ignore' && !analysis)
                  proposal = {
                    ...proposal,
                    action: 'decision',
                    draft: '',
                    responseEvidence: null,
                    title: `Review incomplete conversation: ${proposal.title}`.slice(0, 160),
                    reasoning: limitations.join(' '),
                    questions: [
                      'Check the original conversation for any unanswered request; the saved context is incomplete.',
                    ],
                  }
                const answered =
                  proposal.action === 'ignore' &&
                  proposal.responseEvidence &&
                  conversation.sources.some(
                    (source) =>
                      source.ref === proposal.responseEvidence!.ref &&
                      proposal.responseEvidence!.quote.trim().length > 0 &&
                      source.body.includes(proposal.responseEvidence!.quote),
                  )
                if (proposal.responseEvidence && !answered)
                  throw new Error('The claimed sent reply was not found in the saved conversation. Check again.')
                const responseHistory = [
                  ...(current?.responseHistory ?? []),
                  ...(answered
                    ? [
                        {
                          at: now,
                          sourceVersion: conversation.version,
                          kind: 'captured_reply' as const,
                          evidence: `${proposal.responseEvidence!.ref}: ${proposal.responseEvidence!.quote}`,
                        },
                      ]
                    : []),
                ]
                check = {
                  ...check,
                  title: proposal.title,
                  reason: proposal.reasoning,
                  disposition: answered ? 'answered' : proposal.action === 'ignore' ? 'ignored' : 'review',
                  ...(limitations.length ? { limitations } : {}),
                  ...(analysis ? { requestAnalysisVersion: analysis.stamp.version } : {}),
                }
                if (current && protectedItem && current.status !== 'dismissed' && !answered) {
                  const stale =
                    !analysis ||
                    current.stale ||
                    current.conversation.version !== conversation.version ||
                    Boolean(requestIds?.some((id) => !current.requestIds?.includes(id)))
                  await store.put(
                    {
                      ...current,
                      ...accounting,
                      conversation,
                      stale,
                      reviewRange: range,
                      updated: now,
                    },
                    current.revision,
                  )
                  if (stale) report.stale++
                  check = {
                    ...check,
                    itemId: id,
                    title: current.title,
                    disposition: 'preserved',
                    reason: `${proposal.reasoning} Your existing draft is preserved.${stale ? ' Review the new context.' : ''}`,
                  }
                } else if (proposal.action === 'ignore') {
                  if (current) {
                    await store.put(
                      {
                        ...current,
                        ...accounting,
                        conversation,
                        status: 'dismissed',
                        responseHistory,
                        reviewRange: range,
                        updated: now,
                      },
                      current.revision,
                    )
                  } else if (analysis) {
                    id = await allocate(proposal.title)
                    await store.put(
                      {
                        id,
                        created: now,
                        updated: now,
                        status: 'dismissed',
                        conversation,
                        title: proposal.title,
                        situation: proposal.situation,
                        reasoning: proposal.reasoning,
                        questions: [],
                        draft: '',
                        originalDraft: '',
                        edited: false,
                        stale: false,
                        reviews: [],
                        responseHistory,
                        reviewRange: range,
                        native: null,
                        placementError: null,
                        ...accounting,
                      },
                      null,
                    )
                  }
                  if (answered) report.answered!++
                  else report.ignored++
                } else {
                  id ??= await allocate(proposal.title)
                  await store.put(
                    {
                      id,
                      ...accounting,
                      created: current?.created ?? now,
                      updated: now,
                      status: 'needs_review',
                      conversation,
                      title: proposal.title,
                      situation: proposal.situation,
                      summary: proposal.summary,
                      reasoning: proposal.reasoning,
                      questions: proposal.questions,
                      recommendation: proposal.recommendation,
                      replyOptions: proposal.replyOptions,
                      originalDraft: proposal.draft,
                      draft: proposal.draft,
                      edited: false,
                      stale: false,
                      reviews: current?.reviews ?? [],
                      responseHistory,
                      reviewRange: range,
                      native: null,
                      placementError: null,
                      workstreams: current?.workstreams,
                      intentIds: current?.intentIds,
                      origin: current?.origin,
                      requestSources: current?.workstreams?.length
                        ? conversation.sources.map(({ ref, hash }) => ({ ref, hash }))
                        : undefined,
                    },
                    current?.revision ?? null,
                  )
                  check.itemId = id
                  report.prepared++
                }
              }
            }
            state.handled[key] = conversation.version
            if (id) check.itemRevision = (await store.get(id))?.revision
            const included = new Set(refs)
            state.pending = state.pending.filter((ref) => !included.has(ref))
          } catch (error) {
            report.failed++
            check = { ...check, disposition: 'failed', reason: error instanceof Error ? error.message : String(error) }
          }
          report.checks.push(check)
          report.completed++
          await persist()
        }
        let cursor = 0
        const workers = await Promise.allSettled(
          Array.from({ length: Math.min(Math.max(1, concurrency), queued.length) }, async () => {
            while (cursor < queued.length && cursor < limit) {
              const candidate = queued[cursor++]
              await examine(candidate)
            }
          }),
        )
        const rejected = workers.find((worker) => worker.status === 'rejected')
        if (rejected?.status === 'rejected') throw rejected.reason
        report.outcome =
          report.failed || report.pending
            ? 'failed'
            : report.prepared || report.stale || report.ignored
              ? 'acted'
              : 'nothing'
        report.status = report.outcome === 'failed' ? 'failed' : 'complete'
        await persist()
        const { id: _id, owner: _owner, status: _status, checks: _checks, ...summary } = report
        await atomicWrite(path.join(store.stateDir, 'last-scan.json'), JSON.stringify(summary))
        return summary
      } catch (error) {
        report.status = 'failed'
        report.outcome = 'failed'
        report.error = error instanceof Error ? error.message : String(error)
        await atomicWrite(progressFile, JSON.stringify(report))
        throw error
      }
    },
    false,
  )
}
