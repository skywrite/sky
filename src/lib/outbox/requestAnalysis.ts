import * as path from 'node:path'
import { z } from 'zod'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { AnalysisCache, modelVersion, REQUEST_ANALYSIS_POLICY } from './analysisCache.ts'
import { hash, withLock } from './files.ts'
import { conversationChunks, HISTORY_SOURCE_CHARS } from './history.ts'
import { outboxModel } from './model.ts'
import { inRange, type ScanRange } from './range.ts'
import { createRequestAttention, type OwnerInitiative } from './requestAttention.ts'
import {
  RequestId,
  type RequestAnalysisStamp,
  type RequestCitation,
  type RequestRecord,
  type RequestReport,
} from './requestTypes.ts'
import type { Conversation, OutboxRecord } from './types.ts'

const EXTRACT = new URL('./prompts/requests.prompt.md', import.meta.url).pathname
const RECONCILE = new URL('./prompts/reconcile-requests.prompt.md', import.meta.url).pathname
const TRIAGE = new URL('./prompts/triage.prompt.md', import.meta.url).pathname
const COVERAGE = new URL('./prompts/reply-coverage.prompt.md', import.meta.url).pathname
const Citation = z.object({ unit: RequestId, quote: z.string().min(1).max(2000) })
const Found = z.object({
  summary: z.string().min(1).max(600),
  origin: Citation,
})
const Extraction = z.object({
  complete: z.boolean(),
  reviewedUnits: z.array(RequestId),
  notes: z.string().max(6000),
  requests: z.array(Found),
})
const Assessment = z.object({
  id: RequestId,
  status: z.enum(['open', 'resolved', 'uncertain']),
  explanation: z.string().min(1).max(1600),
  context: z.string().max(3000),
  evidence: z.array(Citation).max(4),
  resolution: Citation.nullable(),
})
const Reconciliation = z.object({ requests: z.array(Assessment) })
type Cite = z.infer<typeof Citation>
type State = z.infer<typeof Assessment> & z.infer<typeof Found>
type Unit = {
  id: string
  message: string
  heading?: string
  at: string | null
  kind: 'message' | 'owner_report'
  from: string
  to: string
  text: string
  ref: string
  offset: number
}

const reading = ({ ref: _ref, offset: _offset, ...unit }: Unit) => unit
const unitId = (unit: Omit<Unit, 'id'>) =>
  hash(
    JSON.stringify([unit.message, unit.heading, unit.offset, unit.kind, unit.at, unit.from, unit.to, unit.text]),
  ).slice(0, 32)

/** Provider anchors identify messages where available; body changes invalidate only affected reading units. */
export function requestUnits(conversation: Conversation): Unit[] {
  const units = new Map<string, Unit>()
  for (const part of conversationChunks(conversation).flat()) {
    const unit: Omit<Unit, 'id'> = {
      message: part.message.key,
      heading: part.heading,
      at: part.message.at,
      offset: part.message.offset,
      kind: 'message',
      from: part.from,
      to: part.to,
      text: part.body.trimEnd(),
      ref: part.ref,
    }
    const id = unitId(unit)
    // Repeated captures of the same message do not introduce another request or another reading pass.
    if (!units.has(id)) units.set(id, { ...unit, id })
  }
  return [...units.values()]
}

function groups<T>(values: T[], maximum: number, chars: number, serialize: (value: T) => unknown): T[][] {
  const result: T[][] = []
  let group: T[] = []
  let size = 2
  for (const value of values) {
    const length = JSON.stringify(serialize(value)).length + 1
    if (group.length && (group.length >= maximum || size + length > chars)) {
      result.push(group)
      group = []
      size = 2
    }
    group.push(value)
    size += length
  }
  if (group.length) result.push(group)
  return result
}

function split(units: Unit[]): [Unit[], Unit[]] {
  if (units.length > 1) {
    const half = Math.ceil(units.length / 2)
    return [units.slice(0, half), units.slice(half)]
  }
  const unit = units[0]
  if (unit.text.length <= 1024)
    throw new Error('Sky could not fully account for a saved message. Check again to retry this part.')
  let half = Math.floor(unit.text.length / 2)
  if (/[\uD800-\uDBFF]/.test(unit.text[half - 1]) && /[\uDC00-\uDFFF]/.test(unit.text[half])) half--
  const left = { ...unit, text: unit.text.slice(0, half) }
  const right = { ...unit, text: unit.text.slice(half), offset: unit.offset + half }
  return [[{ ...left, id: unitId(left) }], [{ ...right, id: unitId(right) }]]
}

function exactIds(actual: string[], expected: string[], label: string): void {
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    expected.some((id) => !actual.includes(id))
  )
    throw new Error(`Sky did not account for every ${label}. Check again to finish this part.`)
}

function evidence(cite: Cite, units: Unit[], prior: Cite[] = []): void {
  if (
    !cite.quote.trim() ||
    ![...units.map((unit) => ({ unit: unit.id, quote: unit.text })), ...prior].some(
      (source) => source.unit === cite.unit && source.quote.includes(cite.quote),
    )
  )
    throw new Error('A request assessment cited text that was not in the reviewed evidence. Check again.')
}

export function requestInRange(request: RequestRecord, range: ScanRange): boolean {
  if (!request.present) return false
  return request.origin.at
    ? inRange(request.origin.at, range)
    : request.origin.ref.slice(0, 10) >= range.start.slice(0, 10) &&
        request.origin.ref.slice(0, 10) <= range.end.slice(0, 10)
}

export type RequestAnalyzer = {
  version: () => Promise<string>
  analyze: (input: { conversation: Conversation; prior: OutboxRecord | null; now: string }) => Promise<{
    requests: RequestRecord[]
    stamp: RequestAnalysisStamp
  }>
}

export function createRequestAnalyzer(options: {
  stateDir: string
  ownerContext: string
  model?: () => ResolvedModel
  initiatives?: OwnerInitiative[]
  today?: string
}): RequestAnalyzer {
  const resolve = options.model ?? outboxModel
  const attention = createRequestAttention({ ...options, model: resolve })
  const prompts = Promise.all(
    [EXTRACT, RECONCILE, TRIAGE, COVERAGE].map(
      async (file) => renderPromptFile(await readPromptFile(file), file, {}).output,
    ),
  )
  const readingVersion = async () =>
    hash(JSON.stringify([REQUEST_ANALYSIS_POLICY, options.ownerContext, modelVersion(resolve()), await prompts]))
  const version = async () => hash(JSON.stringify([await readingVersion(), await attention.version()]))
  return {
    version,
    analyze: async ({ conversation, prior, now }) => {
      const cache = new AnalysisCache(options.stateDir, conversation.key)
      return withLock(path.join(cache.dir, 'read.lock'), async () => {
        const [extractInstructions, reconcileInstructions] = await prompts
        const analysisVersion = await version()
        const units = requestUnits(conversation)
        const allUnits = new Map(units.map((unit) => [unit.id, unit]))
        const states = new Map<string, State>()
        let notes = ''
        // Relevance and presentation changes reuse validated source reading; they have their own receipts.
        let prefix = await readingVersion()
        let reviewed = 0
        const context = { ownerContext: options.ownerContext, medium: conversation.medium }

        const reconcile = async (batch: Unit[], selected: State[], receiptPrefix: string) => {
          for (const page of groups(selected, 4, 24_000, (state) => state)) {
            const result = await cache.run({
              kind: 'reconcile',
              prefix: receiptPrefix,
              model: resolve(),
              schema: Reconciliation,
              repairValidation: true,
              instructions: reconcileInstructions,
              input: { ...context, notes, requests: page, units: batch.map(reading) },
              validate: (result) => {
                exactIds(
                  result.requests.map(({ id }) => id),
                  page.map(({ id }) => id),
                  'request',
                )
                for (const update of result.requests) {
                  const before = page.find(({ id }) => id === update.id)!
                  const known = [before.origin, ...before.evidence, ...(before.resolution ? [before.resolution] : [])]
                  for (const cite of update.evidence) evidence(cite, batch, known)
                  if (update.status === 'resolved') {
                    if (!update.resolution)
                      throw new Error('A resolved request needs exact evidence of its resolution.')
                    evidence(update.resolution, batch, known)
                    const answer = allUnits.get(update.resolution.unit)!
                    const origin = allUnits.get(before.origin.unit)!
                    if (answer.kind === 'message' && answer.at && origin.at && answer.at < origin.at)
                      throw new Error('A request cannot be resolved by a reply preceding it.')
                    if (
                      batch.every((unit) => unit.kind === 'owner_report') &&
                      !batch.some((unit) => unit.id === update.resolution!.unit)
                    )
                      throw new Error('A reported reply must resolve the request in its own wording.')
                  } else if (update.resolution)
                    throw new Error('An unresolved request cannot carry a completed resolution.')
                }
              },
            })
            for (const update of result.requests) states.set(update.id, { ...states.get(update.id)!, ...update })
          }
        }

        const read = async (batch: Unit[]): Promise<void> => {
          for (const unit of batch) allUnits.set(unit.id, unit)
          if (JSON.stringify(batch.map(reading)).length > HISTORY_SOURCE_CHARS) {
            for (const half of split(batch)) await read(half)
            return
          }
          const result = await cache.run({
            kind: 'extract',
            prefix,
            model: resolve(),
            schema: Extraction,
            instructions: extractInstructions,
            onOutputLimit: () => ({ complete: false, reviewedUnits: [], notes: '', requests: [] }),
            input: { ...context, previousNotes: notes, units: batch.map(reading) },
            validate: (result) => {
              if (!result.complete) {
                split(batch)
                return
              }
              exactIds(
                result.reviewedUnits,
                batch.map(({ id }) => id),
                'reading unit',
              )
              for (const request of result.requests) evidence(request.origin, batch)
            },
          })
          if (!result.complete) {
            for (const half of split(batch)) await read(half)
            return
          }
          for (const found of result.requests) {
            const origin = allUnits.get(found.origin.unit)!
            // A deterministic origin identity deduplicates retries and repeated captures. Wording edits get a new identity.
            const id = hash(
              JSON.stringify([conversation.key, origin.message, found.origin.quote.trim().replace(/\s+/g, ' ')]),
            ).slice(0, 32)
            if (!states.has(id))
              states.set(id, {
                ...found,
                id,
                status: 'uncertain',
                explanation: 'Awaiting reconciliation.',
                context: '',
                evidence: [],
                resolution: null,
              })
          }
          // Later messages can withdraw an answer or reopen a previously resolved request.
          await reconcile(batch, [...states.values()], prefix)
          notes = result.notes
          prefix = hash(JSON.stringify([prefix, batch.map(({ id }) => id)]))
          reviewed += batch.length
        }
        for (const batch of groups(units, 32, HISTORY_SOURCE_CHARS, reading)) await read(batch)

        const cite = (value: Cite): RequestCitation => {
          const unit = allUnits.get(value.unit)
          if (!unit || !unit.text.includes(value.quote))
            throw new Error('A saved request no longer matches its source evidence.')
          return {
            kind: unit.kind,
            ref: unit.ref,
            message: unit.message,
            heading: unit.heading,
            at: unit.at,
            quote: value.quote,
          }
        }
        const previous = new Map(prior?.requests?.map((request) => [request.id, request]) ?? [])
        const previousUnits = prior && !prior.requests ? requestUnits(prior.conversation) : []
        const legacyReports: RequestReport[] =
          prior && !prior.requests
            ? (prior.responseHistory ?? [])
                .filter((entry) => entry.kind === 'owner_report')
                .map((entry) => ({
                  at: entry.at,
                  sourceVersion: entry.sourceVersion,
                  evidence: entry.evidence,
                  reply: entry.reply ?? '',
                }))
            : []
        if (prior?.delivery && !prior.requests && !legacyReports.some((report) => report.at === prior.delivery!.at))
          legacyReports.push({ ...prior.delivery, sourceVersion: prior.conversation.version, reply: prior.draft })

        const records: RequestRecord[] = []
        for (let state of states.values()) {
          const origin = cite(state.origin)
          const old = previous.get(state.id)
          const wasPresent = previousUnits.some(
            (unit) => unit.message === origin.message && unit.text.includes(origin.quote),
          )
          const reports = old?.reports ?? (wasPresent ? legacyReports : [])
          const archived =
            prior?.status === 'dismissed' &&
            !prior.requests &&
            !legacyReports.length &&
            wasPresent &&
            (!prior.reviewRange || requestInRange({ origin, present: true } as RequestRecord, prior.reviewRange))
          const dismissal =
            old?.dismissal ??
            (archived
              ? { at: prior!.updated, sourceVersion: prior!.conversation.version, kind: 'legacy' as const }
              : undefined)
          if (!dismissal)
            for (const report of reports) {
              if (state.status === 'resolved') break
              const reportKey = hash(JSON.stringify(report))
              const reportConversation: Conversation = {
                key: conversation.key,
                version: reportKey,
                medium: 'Email',
                target: null,
                limitations: [],
                sources: [
                  {
                    ref: `owner-report:${reportKey}`,
                    hash: reportKey,
                    from: 'Owner report of sending',
                    to: '',
                    body: `Owner evidence: ${report.evidence}\n\nReported sent wording:\n${report.reply}`,
                  },
                ],
              }
              for (const part of requestUnits(reportConversation)) {
                const unit: Unit = { ...part, kind: 'owner_report', at: report.at }
                unit.id = unitId(unit)
                allUnits.set(unit.id, unit)
                await reconcile([unit], [state], hash(JSON.stringify([prefix, state.id, reportKey])))
                state = states.get(state.id)!
                if (state.status === 'resolved') break
              }
            }
          records.push({
            id: state.id,
            summary: state.summary,
            origin,
            present: true,
            status: dismissal ? 'dismissed' : !origin.at && state.status === 'open' ? 'uncertain' : state.status,
            explanation: dismissal ? 'This request was archived with its reviewed conversation.' : state.explanation,
            context: state.context,
            evidence: state.evidence.map(cite),
            resolution: state.resolution ? cite(state.resolution) : null,
            reports,
            ...(dismissal ? { dismissal } : {}),
          })
        }
        // Retain human decisions even when their original message was edited or removed; never transfer them to a new ask.
        for (const old of previous.values())
          if (!states.has(old.id)) records.push({ ...old, present: false, response: undefined })
        return {
          requests: await attention.assess(conversation, records, cache),
          stamp: { version: analysisVersion, sourceVersion: conversation.version, updated: now, units: reviewed },
        }
      })
    },
  }
}
