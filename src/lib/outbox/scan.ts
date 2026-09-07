import * as path from 'node:path'
import { atomicWrite, hash, readOptional, withLock } from './files.ts'
import { InventorySchema, type SavedMessages } from './sources.ts'
import type { OutboxStore } from './store.ts'
import { OutboxError, type Conversation, type DraftProposal, type Review, type ScanReport } from './types.ts'

export type Propose = (input: {
  conversation: Conversation
  preferences: string
  examples: Review[]
}) => Promise<DraftProposal>

export async function scanOutbox(options: {
  store: OutboxStore
  sources: SavedMessages
  today: string
  now: string
  propose: Propose
  limit?: number
}): Promise<ScanReport> {
  const { store, sources, today, now, propose, limit = 5 } = options
  return withLock(
    path.join(store.stateDir, 'scan.lock'),
    async () => {
      const stateFile = path.join(store.stateDir, 'sources.json')
      const saved = await readOptional(stateFile)
      // Damage is an error, never permission to forget the baseline and replay today's work.
      const prior = saved === undefined ? null : InventorySchema.parse(JSON.parse(saved))
      const state = await sources.discover(prior, today)
      const persist = () => atomicWrite(stateFile, JSON.stringify(state))
      await persist()
      const report: ScanReport = {
        outcome: 'nothing',
        considered: 0,
        prepared: 0,
        ignored: 0,
        stale: 0,
        failed: 0,
        pending: state.pending.length,
      }
      const preferences = (await store.preferences()).text
      const records = await store.list()
      const examples = records
        .flatMap((item) => item.reviews)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 12)
      const visited = new Set<string>()
      const queued = state.pending
      for (const ref of queued) {
        if (report.considered >= limit) break
        if (!state.pending.includes(ref)) continue
        try {
          const conversation = await sources.conversation(ref)
          if (!conversation || state.handled[conversation.key] === conversation.version) {
            state.pending = state.pending.filter((value) => value !== ref)
            continue
          }
          if (visited.has(conversation.key)) continue
          visited.add(conversation.key)
          report.considered++
          const id = hash(conversation.key).slice(0, 32)
          const current = await store.get(id)
          if (current?.status === 'placing' || current?.status === 'placement_unknown') continue
          if (current?.conversation.version === conversation.version) {
            // Review can refresh a snapshot before the next scheduled pass.
          } else if (current && current.status !== 'dismissed' && (current.edited || current.native)) {
            await store.put({ ...current, conversation, stale: true, updated: now }, current.revision)
            report.stale++
          } else {
            const proposal = await propose({ conversation, preferences, examples })
            // Capture may finish while the model works. A draft of the old conversation must never look current.
            const fresh = await sources.current(conversation)
            if (fresh.version !== conversation.version) continue
            if (proposal.action === 'ignore') {
              if (current && current.status !== 'dismissed') {
                await store.put({ ...current, conversation, status: 'dismissed', updated: now }, current.revision)
              }
              report.ignored++
            } else {
              await store.put(
                {
                  id,
                  created: current?.created ?? now,
                  updated: now,
                  status: 'needs_review',
                  conversation,
                  title: proposal.title,
                  situation: proposal.situation,
                  reasoning: proposal.reasoning,
                  questions: proposal.questions,
                  originalDraft: proposal.draft,
                  draft: proposal.draft,
                  edited: false,
                  stale: false,
                  reviews: current?.reviews ?? [],
                  native: null,
                  placementError: null,
                },
                current?.revision ?? null,
              )
              report.prepared++
            }
          }
          state.handled[conversation.key] = conversation.version
          const included = new Set(conversation.sources.map((source) => source.ref))
          state.pending = state.pending.filter((value) => !included.has(value))
        } catch (error) {
          // An editor winning a revision race is ordinary contention; retain the queued source for the next pass.
          if (!(error instanceof OutboxError && error.status === 409)) report.failed++
          state.pending = [...state.pending.filter((value) => value !== ref), ref]
        }
        await persist()
      }
      await persist()
      report.pending = state.pending.length
      report.outcome = report.failed
        ? 'failed'
        : report.prepared || report.stale || report.ignored
          ? 'acted'
          : 'nothing'
      await atomicWrite(path.join(store.stateDir, 'last-scan.json'), JSON.stringify({ ...report, at: now }))
      return report
    },
    false,
  )
}
