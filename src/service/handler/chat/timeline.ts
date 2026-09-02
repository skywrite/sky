/**
 * The context, turn by turn — what a thread's Context panel tells.
 *
 * The context log records every turn for resume: the seed universe, the
 * documents queries added, a snapshot of what is cut, the tools the model
 * called. A person watching a conversation wants each turn's change — what
 * came in, what the budget pushed out to make room, what was read by tool
 * — so this derives that from consecutive entries and ships only the
 * change, never the whole universe again.
 */

import type {
  ContextDocRecord,
  ContextTurnLog,
  ToolCallRecord,
  TurnStats,
} from '#shared/models/Chat/document/ContextLog/mod.ts'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'

/**
 * What a turn did to the context: `seed` gathered the baseline, `grew`
 * ran new queries and reassembled, `same` reused the last assembly, and
 * `failed` recorded errors and no assembly.
 */
export type TimelineKind = 'seed' | 'grew' | 'same' | 'failed'

export interface TimelineEntry {
  turn: number
  /** Notebook stamp of the message that started the turn, `HH:MM`; null when unstamped */
  when: string | null
  kind: TimelineKind
  /** Queries new this turn */
  searches: number
  stats?: TurnStats
  /** Turn 1: how many documents the baseline gathered, shipped and cut alike */
  found?: number
  /** Documents queries brought into the universe this turn, cut ones included */
  added: ContextDocRecord[]
  /** Documents the model saw before that the budget cut this turn */
  pushedOut: ContextDocRecord[]
  tools: ToolCallRecord[]
  errors: string[]
}

/** A cut the budget made — not the person's own exclusion, not a scorer verdict. */
function byBudget(rec: ContextDocRecord): boolean {
  return rec.cut === 'budget' || rec.cut === 'floor'
}

function kindOf(entry: ContextTurnLog): TimelineKind {
  if (entry.universe) return 'seed'
  if (entry.stats?.reused) return 'same'
  if (entry.stats) return 'grew'
  return entry.errors?.length ? 'failed' : 'same'
}

/**
 * The turn-by-turn story of a context log. `turns` supplies the stamps:
 * the k-th entry belongs to the k-th user message.
 */
export function timelineOf(log: ContextTurnLog[], turns: ConversationMessage[]): TimelineEntry[] {
  const stamps = turns.filter((t) => t.role === 'user').map((t) => t.when?.slice(11) ?? null)
  const out: TimelineEntry[] = []
  // The budget's cuts as of the last assembly — a reused or failed turn carries them forward.
  let cutBefore = new Set<string>()
  let queriesBefore = new Set<string>()

  for (const entry of log) {
    const kind = kindOf(entry)
    const added = kind === 'seed' ? [] : (entry.diff ?? [])
    const snapshot = kind === 'seed' ? entry.universe : kind === 'grew' ? (entry.pruned ?? []) : null

    let pushedOut: ContextDocRecord[] = []
    if (snapshot) {
      const cutNow = snapshot.filter(byBudget)
      // Nothing was in before the seed; a document new this turn that never
      // fit was added and cut, not pushed out.
      const newPaths = new Set(added.map((r) => r.path))
      if (kind !== 'seed') pushedOut = cutNow.filter((r) => !cutBefore.has(r.path) && !newPaths.has(r.path))
      cutBefore = new Set(cutNow.map((r) => r.path))
    }

    const searches = entry.queries.filter((q) => !queriesBefore.has(q)).length
    queriesBefore = new Set(entry.queries)

    const item: TimelineEntry = {
      turn: entry.turn,
      when: stamps[entry.turn - 1] ?? null,
      kind,
      searches,
      added,
      pushedOut,
      tools: entry.tools ?? [],
      errors: entry.errors ?? [],
    }
    if (entry.stats) item.stats = entry.stats
    if (kind === 'seed') item.found = entry.universe?.length ?? 0
    out.push(item)
  }
  return out
}
