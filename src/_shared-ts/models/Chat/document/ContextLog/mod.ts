/**
 * The context log ai:chat appends to saved transcripts — a single trailing
 * `<!-- CONTEXT-LOG ... -->` HTML comment holding versioned JSON, recording
 * what the context pipeline did each turn. Resume depends on it: the
 * recorded universe (turn-1 `universe` plus every `diff` and `pruned`
 * snapshot) and `queries` are what let a later session restore the chat's
 * context state instead of re-deriving it.
 *
 * The `version` field is for detection, not compatibility: the reader
 * supports the current version only, and anything else — a future version,
 * hand-mangled JSON, or the pre-JSON `<!-- TURN N ... -->` text format —
 * parses to "no log", so resume falls back to a fresh context gather.
 * Legacy `<!-- TURN` runs are still recognized structurally and split off
 * the body (their contents are never parsed) so old transcripts keep clean
 * conversations; an unreadable CONTEXT-LOG block stays inert in the body.
 *
 * Round-trip law: for writer-produced files,
 * `body + serializeContextLog(entries) === markdown`. Serialization is
 * deterministic (fixed key order, one line per record) and JSON is immune to
 * the notebook's whitespace normalizer — no line-trailing spaces exist, and
 * the parser tolerates a collapsed final newline. Any `-->` inside a string
 * value is escaped as `--\u003e` so it cannot terminate the comment early;
 * JSON.parse restores the original text, keeping the law exact.
 *
 * Fields grow within a version additively — v2 records gained the optional
 * `lex`/`prov` score parts with the Stage 2 scorer, stats gained the
 * operative scoring parameters (`budget`/`scoring`/`floor`/`floored` with
 * Stage 3, `baseline` with the opt-in summary baseline), and the
 * sweep-stratified admission added `policy`/`sweep` on stats plus `via` on
 * doc records — recorded because they are tunable and a logged score is
 * only interpretable against the parameters that produced it, and the
 * memory distiller added `memory` on entries (the session's ai/memory ops)
 * and the person-facts distiller added `people` (the session's profile ops).
 * Optional fields never bump the version: the reader tolerates their
 * absence, and a bump would orphan resume for every transcript already on
 * disk.
 */

import type { TokenUsage } from '#shared/ai/usage.ts'
import type { QueryTruncation } from '#shared/models/DomainCollection/query/resolvers/shared.ts'
import type { MemoryOpOutcome } from '#shared/models/Memory/write.ts'
import type { PersonOpOutcome } from '#shared/models/Person/write.ts'
import type { TimingDetail } from '#shared/timing/summary.ts'

export const CONTEXT_LOG_VERSION = 2

/** How deliberately queries retrieved a doc, from result-set selectivity. */
export type RetrievalTier = 'targeted' | 'medium' | 'broad'

/** One document the context pipeline saw this turn. */
export interface ContextDocRecord {
  /** Notebook-relative path */
  path: string
  /** Scorer output; absent on pinned docs */
  score?: number
  /** Estimated tokens of the document's markdown */
  tokens: number
  /** Lexical topic-match part of the score (0–8); absent when ~0 */
  lex?: number
  /** Best retrieval-evidence tier; absent = baseline or expansion doc */
  prov?: RetrievalTier
  /** Pinned docs bypass scoring and the budget */
  pinned?: true
  /** Why the doc was NOT shipped: 'budget' or a scorer-verdict reason. Absent = shipped. */
  cut?: string
  /** How the doc was shipped when not by rank: 'reserve' = per-slice coverage guarantee */
  via?: 'reserve'
}

/** One tool call the model made during a turn. */
export interface ToolCallRecord {
  tool: string
  /** Short digest of the input (url, query, or stringified head) */
  input?: string
  outcome: 'ok' | 'error' | 'denied'
  /** Estimated tokens of the result fed back to the model */
  tokens?: number
}

export interface TurnStats {
  kept: number
  pruned: number
  excluded: number
  /** Estimated tokens of shipped document markdown (the assembler budget) */
  docTokens: number
  /** Token budget ceiling in effect this turn */
  budget?: number
  /** Scoring-semantics tag (see Chat/ChatContext/score.ts SCORING) */
  scoring?: string
  /** Baseline seeding strategy when not the default raw sweep (opt-in 'summary') */
  baseline?: string
  /** Admission policy when not the default score-rank walk ('sweep-stratified') */
  policy?: string
  /** The user-stated window driving a non-default policy, as `since` or `since..until` */
  sweep?: string
  /** Exact first day of the stated range, when the window resolved one */
  sweepFrom?: string
  /** Relevance floor applied this turn (floorFraction × top score) */
  floor?: number
  /** Docs cut by the floor this turn (their records carry cut: 'floor') */
  floored?: number
  /**
   * Query root fields whose results hit a cap this turn — the documents the
   * pipeline never saw. Without this, a capped gather reads as a complete one
   * when the log is inspected or a session resumes from it.
   */
  truncated?: QueryTruncation[]
  /**
   * This turn reused the previous rebuild's partition (a quiet turn:
   * queries unchanged, context byte-identical, prompt cache preserved).
   * The numbers describe the context as shipped this turn; per-turn events
   * (truncated) are not carried. Absent stats + errors = a broken turn.
   */
  reused?: boolean
}

export interface ContextTurnLog {
  turn: number
  queries: string[]
  stats?: TurnStats
  /** Turn 1 only: the full gathered universe, shipped and cut alike */
  universe?: ContextDocRecord[]
  /** Turns 2+: docs queries added to the universe this turn */
  diff?: ContextDocRecord[]
  /** Turns 2+: snapshot of docs currently cut by budget or verdict */
  pruned?: ContextDocRecord[]
  /** Tool calls the model made this turn */
  tools?: ToolCallRecord[]
  /**
   * Save-time memory distillation outcomes (ai/memory/ ops, applied and
   * skipped alike). Written as a fresh final entry appended at save — never
   * onto an entry a resume carried forward, which the resume write-back
   * self-check compares byte-for-byte.
   */
  memory?: MemoryOpOutcome[]
  /**
   * Save-time person-profile distillation outcomes (people/ ops, applied
   * and skipped alike). Rides the same appended final entry as `memory`.
   */
  people?: PersonOpOutcome[]
  /** Context-pipeline failures this turn (also in ai-errors.jsonl) */
  errors?: string[]
  /** The turn's token counts, every model step summed (also in ai-usage.jsonl per call) */
  usage?: TokenUsage
  /** Prompt-to-result elapsed time and individual calls; independent of transcript minute stamps. */
  timing?: TimingDetail
  /** The model that answered this turn (the provider's id, as the frontmatter's `model:` names the last one) — a thread may switch between turns */
  model?: string
}

const MARKER = '<!-- CONTEXT-LOG'

export function serializeContextLog(entries: ContextTurnLog[]): string {
  if (entries.length === 0) return ''

  const lines: string[] = ['{', `  "version": ${CONTEXT_LOG_VERSION},`, '  "turns": [']
  entries.forEach((entry, i) => {
    lines.push('    {')
    const fields: string[] = [`      "turn": ${entry.turn}`, stringArrayField('queries', entry.queries)]
    if (entry.stats) fields.push(`      "stats": ${JSON.stringify(entry.stats)}`)
    if (entry.universe && entry.universe.length > 0) fields.push(recordArrayField('universe', entry.universe))
    if (entry.diff && entry.diff.length > 0) fields.push(recordArrayField('diff', entry.diff))
    if (entry.pruned && entry.pruned.length > 0) fields.push(recordArrayField('pruned', entry.pruned))
    if (entry.tools && entry.tools.length > 0) fields.push(recordArrayField('tools', entry.tools))
    if (entry.memory && entry.memory.length > 0) fields.push(recordArrayField('memory', entry.memory))
    if (entry.people && entry.people.length > 0) fields.push(recordArrayField('people', entry.people))
    if (entry.errors && entry.errors.length > 0) fields.push(stringArrayField('errors', entry.errors))
    if (entry.usage) fields.push(`      "usage": ${JSON.stringify(entry.usage)}`)
    if (entry.timing) fields.push(`      "timing": ${JSON.stringify(entry.timing)}`)
    if (entry.model) fields.push(`      "model": ${JSON.stringify(entry.model)}`)
    lines.push(fields.join(',\n'))
    lines.push(i < entries.length - 1 ? '    },' : '    }')
  })
  lines.push('  ]', '}')

  // `-->` inside a string value would terminate the HTML comment early.
  // \u003e survives JSON.parse as `>`, so the escape is round-trip exact.
  const json = lines.join('\n').replaceAll('-->', '--\\u003e')
  return `\n\n${MARKER}\n${json}\n-->\n`
}

/** Strings one per line; empty stays inline so `queries: []` reads at a glance. */
function stringArrayField(name: string, values: string[]): string {
  if (values.length === 0) return `      "${name}": []`
  return `      "${name}": [\n${values.map((v) => `        ${JSON.stringify(v)}`).join(',\n')}\n      ]`
}

/** Records one per line — the log stays scannable at hundreds of documents. */
function recordArrayField(name: string, records: object[]): string {
  return `      "${name}": [\n${records.map((r) => `        ${JSON.stringify(r)}`).join(',\n')}\n      ]`
}

/**
 * Split a chat body into the conversation markdown and the parsed log.
 *
 * A CONTEXT-LOG block is recognized only when it starts at a line start and
 * its JSON parses at the current version — conversation text that merely
 * quotes the marker stays in the body, and a corrupted block is left in the
 * body untouched (HTML comments are invisible in rendered markdown and are
 * stripped before documents reach the model). Legacy `<!-- TURN` runs at
 * EOF are split off without being parsed.
 */
export function splitContextLog(markdown: string): { body: string; entries: ContextTurnLog[] } {
  const v2 = findLogBlock(markdown)
  if (v2) return { body: trimBody(markdown.slice(0, v2.start)), entries: v2.entries }

  const legacyStart = legacyLogStartIndex(markdown)
  if (legacyStart !== -1) return { body: trimBody(markdown.slice(0, legacyStart)), entries: [] }

  return { body: markdown, entries: [] }
}

/** The serializer's separator newlines collapse back to the body's own single trailing newline. */
function trimBody(body: string): string {
  return body.replace(/\n+$/, '\n')
}

// (?:(?!-->)[\s\S])* — comment content that can never cross a `-->`. The
// writer escapes interior `-->`, so the first terminator ends the block; the
// trailing \n* tolerates a normalizer-collapsed final newline.
const LOG_BLOCK = /^<!-- CONTEXT-LOG\n((?:(?!-->)[\s\S])*)\n-->\n*$/

function findLogBlock(markdown: string): { start: number; entries: ContextTurnLog[] } | null {
  let from = 0
  let idx: number
  while ((idx = markdown.indexOf(MARKER, from)) !== -1) {
    const atLineStart = idx === 0 || markdown[idx - 1] === '\n'
    if (atLineStart) {
      const match = markdown.slice(idx).match(LOG_BLOCK)
      const entries = match ? parseLogJson(match[1]) : null
      if (entries) return { start: idx, entries }
    }
    from = idx + 1
  }
  return null
}

function parseLogJson(text: string): ContextTurnLog[] | null {
  try {
    const parsed = JSON.parse(text)
    if (parsed?.version !== CONTEXT_LOG_VERSION || !Array.isArray(parsed.turns)) return null
    for (const t of parsed.turns) {
      if (typeof t?.turn !== 'number' || !Array.isArray(t.queries)) return null
    }
    return parsed.turns as ContextTurnLog[]
  } catch {
    return null
  }
}

// The pre-JSON format: an unbroken run of `<!-- TURN N ... -->` comments at
// EOF. Recognized so legacy transcripts keep clean conversation bodies, but
// never parsed — a chat carrying one resumes as if it had no log.
const LEGACY_BLOCK_PATTERN = /^(?:<!-- TURN \d+\n(?:(?!-->)[\s\S])*-->\n*)+$/

function legacyLogStartIndex(markdown: string): number {
  let from = 0
  let idx: number
  while ((idx = markdown.indexOf('<!-- TURN ', from)) !== -1) {
    const atLineStart = idx === 0 || markdown[idx - 1] === '\n'
    if (atLineStart && LEGACY_BLOCK_PATTERN.test(markdown.slice(idx))) return idx
    from = idx + 1
  }
  return -1
}
