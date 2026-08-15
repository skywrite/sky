import type DomainCollection from '#shared/models/DomainCollection/mod.ts'
import {
  Collection,
  type CollectionItem,
  type Document,
  type MarkdownOutputOptions,
} from '#shared/models/Markdown/mod.ts'

/**
 * A scorer's decision for a single document. Intent is explicit — there are
 * no sentinel scores:
 *
 * - `scored` — eligible for context; competes for the token budget by score
 * - `always` — kept unconditionally (pinned), regardless of budget
 * - `never`  — excluded unconditionally, regardless of available room
 *
 * `always`/`never` carry an optional human-readable `reason` that flows into
 * logs (e.g. ai:chat's per-turn context log).
 */
export type ScoreVerdict =
  | { keep: 'scored'; score: number }
  | { keep: 'always'; reason?: string }
  | { keep: 'never'; reason?: string }

const ALWAYS: ScoreVerdict = Object.freeze({ keep: 'always' })
const NEVER: ScoreVerdict = Object.freeze({ keep: 'never' })

/** Verdict constructor: eligible, competes for budget by score. */
export function scored(score: number): ScoreVerdict {
  return { keep: 'scored', score }
}

/** Verdict constructor: keep unconditionally (pinned). */
export function keepAlways(reason?: string): ScoreVerdict {
  return reason === undefined ? ALWAYS : { keep: 'always', reason }
}

/** Verdict constructor: exclude unconditionally. */
export function keepNever(reason?: string): ScoreVerdict {
  return reason === undefined ? NEVER : { keep: 'never', reason }
}

/**
 * Canonical numeric projection of a verdict, for sorting scored items and for
 * numeric surfaces like logs (`score=Infinity` / `score=-Infinity`). Derived
 * from intent — never stored alongside it — so the two cannot disagree.
 */
export function verdictScore(v: ScoreVerdict): number {
  switch (v.keep) {
    case 'always':
      return Infinity
    case 'never':
      return -Infinity
    case 'scored':
      return v.score
  }
}

/**
 * Compatibility net: a `scored` verdict carrying an infinite score is a
 * sentinel from unmigrated code — normalize it to the explicit intent.
 */
function normalizeVerdict(v: ScoreVerdict): ScoreVerdict {
  if (v.keep === 'scored') {
    if (v.score === Infinity) return ALWAYS
    if (v.score === -Infinity) return NEVER
  }
  return v
}

/**
 * Scores a single document for relevance/priority.
 * Returns a ScoreVerdict — see `scorers.ts` for the default implementations.
 */
export type Scorer = (item: CollectionItem<Document>) => ScoreVerdict

/**
 * Coverage reserve: guarantee every slice of a partition key minimum
 * representation before the global score-rank walk. Exists because rank
 * admission optimizes the sum of individual scores, and for set-level asks
 * ("everything from X through Y") the kept set must also SPAN the window —
 * a property no per-doc score can express. Slices admit oldest-first so the
 * starved end of a sweep is funded before the budget can run out.
 */
export interface ReserveOptions {
  /** Slice key for an item (e.g. its month), or null to leave it out of the reserve. */
  sliceOf: (item: CollectionItem<Document>) => string | null
  /** Max documents reserved per slice. */
  maxDocs: number
  /** Max reserved tokens per slice — but a slice's best doc is admitted even oversized. */
  maxTokens: number
}

/** A document annotated with its verdict, projected score, and token cost. */
export interface ScoredItem {
  item: CollectionItem<Document>
  /** The scorer's decision — source of truth, honored by every (re)partition. */
  verdict: ScoreVerdict
  /** Numeric projection of the verdict (see verdictScore). Higher = more important. */
  score: number
  /** Estimated token count for this document's markdown. */
  tokens: number
}

/**
 * Rough token estimate: 1 token ≈ 4 characters.
 * Not exact, but fast and good enough for budgeting. Avoids needing a real
 * tokenizer dependency.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Scores, budgets, and prunes a DomainCollection for AI context windows.
 *
 * ## What it does
 *
 * Given a DomainCollection (a bag of related documents), ContextAssembler:
 * 1. **Scores** each document using a pluggable Scorer (verdict per document)
 * 2. **Partitions** by verdict: `always` → kept, `never` → excluded,
 *    `scored` → sorted by score and budget-walked into kept or pruned
 *
 * The result is four lists:
 * - `kept`     — pinned documents plus the highest-scored ones that fit the budget
 * - `pruned`   — eligible documents that didn't fit (budget's fault; recoverable)
 * - `floored`  — scored documents under the relevance floor (irrelevance's
 *               fault; a looser budget does NOT recover them)
 * - `excluded` — documents the scorer banned outright (intent's fault; never recovered)
 *
 * ## Relevance floor
 *
 * With `floorFraction` set, scored items below `floorFraction × the top
 * scored item's score` are floored before the budget walk — context sizes
 * to the question instead of filling the budget with weak matches. The top
 * item always clears its own floor, so a floor can never empty the
 * eligible set, and an ambient universe (top score ≤ 0) gets no floor at
 * all. Pinned items are exempt. Without `floorFraction` (the default)
 * nothing changes — `floored` stays empty.
 *
 * ## Immutability
 *
 * Every instance is immutable. The `with*()` methods return NEW instances
 * with the changed parameter — the original is never modified.
 *
 * - `withBudget(n)` — re-partitions the SAME scored items with a new budget
 *   (cheap: no re-scoring). Verdicts are honored again: pruned items can be
 *   recovered by a looser budget, excluded items never come back.
 * - `withCollection(c)` / `withScorer(s)` — re-scores from scratch
 *   (scores depend on the collection/scorer, so they must be recomputed)
 *
 * ## Token budget
 *
 * The budget is a soft cap. `always` items are kept first and count against
 * the budget. Among `scored` items, at least one is kept even if it alone
 * exceeds the budget, so the assembler never produces empty output when
 * eligible documents exist. (A collection whose documents are ALL excluded
 * correctly produces empty output.) Check `overBudget` for the oversized case.
 *
 * ## Usage
 *
 * ```ts
 * const asm = ContextAssembler.from(collection, {
 *   scorer: createRecencyTypeScorer(today),
 *   maxTokens: 4000,
 * })
 *
 * asm.kept       // pinned + highest-priority docs that fit
 * asm.pruned     // eligible docs that didn't fit the budget
 * asm.excluded   // docs the scorer banned (with reasons)
 * asm.overBudget // true if kept items exceed maxTokens
 * asm.toMarkdown() // render kept docs as markdown for an AI prompt
 * ```
 */
export default class ContextAssembler {
  // --- Internal state (all frozen/readonly) ---

  private readonly _kept: readonly ScoredItem[]
  private readonly _pruned: readonly ScoredItem[]
  private readonly _floored: readonly ScoredItem[]
  private readonly _excluded: readonly ScoredItem[]
  private readonly _reserved: readonly ScoredItem[]
  private readonly _floorValue: number | null
  private readonly _totalTokens: number

  // These are stored so with*() methods can derive new instances
  private readonly _scorer: Scorer
  private readonly _maxTokens: number
  private readonly _floorFraction: number | undefined
  private readonly _reserve: ReserveOptions | undefined
  private readonly _collection: DomainCollection

  private constructor(
    parts: Partitioned,
    scorer: Scorer,
    maxTokens: number,
    floorFraction: number | undefined,
    reserve: ReserveOptions | undefined,
    collection: DomainCollection,
  ) {
    this._kept = parts.kept
    this._pruned = parts.pruned
    this._floored = parts.floored
    this._excluded = parts.excluded
    this._reserved = parts.reserved
    this._floorValue = parts.floorValue
    this._totalTokens = parts.kept.reduce((sum, s) => sum + s.tokens, 0)
    this._scorer = scorer
    this._maxTokens = maxTokens
    this._floorFraction = floorFraction
    this._reserve = reserve
    this._collection = collection
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Build a ContextAssembler from a DomainCollection.
   *
   * This is the main entry point. It scores every document, partitions by
   * verdict, applies the relevance floor, and budget-walks the scored bucket.
   *
   * @param maxTokens - Token budget. Defaults to Infinity (keep everything eligible).
   * @param floorFraction - Relevance floor as a fraction of the top scored
   *   item's score. Defaults to none (no floor).
   */
  static from(
    collection: DomainCollection,
    opts: { scorer: Scorer; maxTokens?: number; floorFraction?: number; reserve?: ReserveOptions },
  ): ContextAssembler {
    const { scorer, maxTokens = Infinity, floorFraction, reserve } = opts
    const items = scoreItems(collection, scorer)
    return new ContextAssembler(
      partition(items, maxTokens, floorFraction, reserve),
      scorer,
      maxTokens,
      floorFraction,
      reserve,
      collection,
    )
  }

  // ---------------------------------------------------------------------------
  // Read state
  // ---------------------------------------------------------------------------

  /** Pinned documents plus scored documents that fit the budget, by score descending. */
  get kept(): readonly ScoredItem[] {
    return this._kept
  }

  /** Eligible documents that were cut to stay within budget, in score order. */
  get pruned(): readonly ScoredItem[] {
    return this._pruned
  }

  /**
   * Scored documents under the relevance floor, in score order. Unlike
   * `pruned`, a looser budget never recovers them — only a new score or a
   * different floor can.
   */
  get floored(): readonly ScoredItem[] {
    return this._floored
  }

  /** The floor applied this partition (floorFraction × top score), null when none was. */
  get floorValue(): number | null {
    return this._floorValue
  }

  /** Documents excluded by scorer verdict (`keep: 'never'`), regardless of budget. */
  get excluded(): readonly ScoredItem[] {
    return this._excluded
  }

  /**
   * Kept documents that owe their place to the coverage reserve — they were
   * admitted per-slice before the rank walk (and would not all have survived
   * it). Subset of `kept`; empty without a reserve.
   */
  get reserved(): readonly ScoredItem[] {
    return this._reserved
  }

  /** Sum of estimated tokens across all kept documents. */
  get totalTokens(): number {
    return this._totalTokens
  }

  /**
   * True if totalTokens exceeds maxTokens. Happens when pinned documents
   * exceed the budget on their own, or when a single scored document is
   * larger than the budget (at least one eligible document is always kept).
   */
  get overBudget(): boolean {
    return this._totalTokens > this._maxTokens
  }

  /** Number of kept documents. */
  get size(): number {
    return this._kept.length
  }

  // ---------------------------------------------------------------------------
  // Derive new instances
  // ---------------------------------------------------------------------------

  /**
   * Return a new ContextAssembler with a different token budget.
   *
   * Re-partitions the same scored items — does NOT re-score. Tightening the
   * budget prunes more items, loosening it recovers them. Excluded items stay
   * excluded at any budget: their verdict is stored on the item and honored
   * by every re-partition.
   */
  withBudget(maxTokens: number): ContextAssembler {
    const all = [...this._kept, ...this._pruned, ...this._floored, ...this._excluded]
    return new ContextAssembler(
      partition(all, maxTokens, this._floorFraction, this._reserve),
      this._scorer,
      maxTokens,
      this._floorFraction,
      this._reserve,
      this._collection,
    )
  }

  /**
   * Return a new ContextAssembler with a different collection.
   * Re-scores from scratch (new docs need new scores).
   */
  withCollection(collection: DomainCollection): ContextAssembler {
    return ContextAssembler.from(collection, {
      scorer: this._scorer,
      maxTokens: this._maxTokens,
      floorFraction: this._floorFraction,
      reserve: this._reserve,
    })
  }

  /**
   * Return a new ContextAssembler with a different scorer.
   * Re-scores from scratch (different scorer = different scores).
   */
  withScorer(scorer: Scorer): ContextAssembler {
    return ContextAssembler.from(this._collection, {
      scorer,
      maxTokens: this._maxTokens,
      floorFraction: this._floorFraction,
      reserve: this._reserve,
    })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * Render kept documents as markdown, suitable for injecting into an AI prompt.
   * Delegates to Collection.toMarkdown() so the output format (delimiters,
   * path comments, type-based ordering) stays consistent with the rest of the
   * system.
   */
  toMarkdown(opts?: MarkdownOutputOptions): string {
    if (this._kept.length === 0) return ''
    const docs = this._kept.map((s) => ({ doc: s.item.doc, path: s.item.path, depth: s.item.depth }))
    return Collection.from(docs).toMarkdown(opts)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Partitioned {
  kept: readonly ScoredItem[]
  pruned: readonly ScoredItem[]
  floored: readonly ScoredItem[]
  excluded: readonly ScoredItem[]
  reserved: readonly ScoredItem[]
  floorValue: number | null
}

/**
 * Run the scorer over every item in the collection. Each item stores the
 * (normalized) verdict, its numeric projection, and its estimated token cost.
 */
function scoreItems(collection: DomainCollection, scorer: Scorer): ScoredItem[] {
  return collection.allItems.map((item) => {
    const verdict = normalizeVerdict(scorer(item))
    return {
      item,
      verdict,
      score: verdictScore(verdict),
      tokens: estimateTokens(item.doc.toMarkdown()),
    }
  })
}

/**
 * Sort comparator: highest score first. On ties, prefer the smaller document
 * (fewer tokens) since it preserves more budget for other items.
 *
 * Compares with explicit inequality rather than subtraction so equal infinite
 * projections (all `always` items are Infinity, all `never` items -Infinity)
 * fall through to the size tie-break instead of producing NaN.
 */
function byScoreDescThenSizeAsc(a: ScoredItem, b: ScoredItem): number {
  if (a.score !== b.score) return a.score < b.score ? 1 : -1
  return a.tokens - b.tokens
}

/**
 * Partition scored items by verdict, apply the relevance floor, then
 * budget-walk the scored bucket.
 *
 * The single partition implementation shared by `from()` and `withBudget()`,
 * so construction and re-budgeting cannot disagree about verdict semantics:
 * - `always` → kept unconditionally, first, counted against the budget
 * - `never`  → excluded unconditionally, regardless of available room
 * - `scored` → floored below floorFraction × top score, the rest sorted by
 *   score desc and kept while the budget allows
 *
 * Among scored items, at least one is kept even if it alone exceeds the
 * budget (never produce empty output when eligible items exist). The floor
 * cannot violate that: the top item always clears its own floor, and an
 * ambient universe (top score ≤ 0) gets no floor at all.
 */
function partition(
  items: ScoredItem[],
  maxTokens: number,
  floorFraction?: number,
  reserve?: ReserveOptions,
): Partitioned {
  const always: ScoredItem[] = []
  let eligible: ScoredItem[] = []
  const excluded: ScoredItem[] = []

  for (const s of items) {
    switch (s.verdict.keep) {
      case 'always':
        always.push(s)
        break
      case 'never':
        excluded.push(s)
        break
      case 'scored':
        eligible.push(s)
        break
    }
  }

  always.sort(byScoreDescThenSizeAsc)
  eligible.sort(byScoreDescThenSizeAsc)
  excluded.sort(byScoreDescThenSizeAsc)

  let floored: ScoredItem[] = []
  let floorValue: number | null = null
  if (floorFraction !== undefined && eligible.length > 0 && eligible[0].score > 0) {
    floorValue = eligible[0].score * floorFraction
    const floor = floorValue
    floored = eligible.filter((s) => s.score < floor)
    eligible = eligible.filter((s) => s.score >= floor)
  }

  // Coverage reserve: per-slice admission before the rank walk. Draws from
  // eligible AND floored — inside an asked-for window, a weak old doc is the
  // era's only witness, not padding — and admits oldest slice first so the
  // budget cannot run out before the starved end is funded. Each slice gets
  // its best doc even oversized (mirrors the at-least-one law below).
  const reserved: ScoredItem[] = []
  if (reserve) {
    const bySlice = new Map<string, ScoredItem[]>()
    for (const s of [...eligible, ...floored]) {
      const key = reserve.sliceOf(s.item)
      if (key === null) continue
      const slice = bySlice.get(key) ?? []
      slice.push(s)
      bySlice.set(key, slice)
    }
    const alwaysTokens = always.reduce((sum, s) => sum + s.tokens, 0)
    let reservedTokens = 0
    for (const key of [...bySlice.keys()].sort()) {
      const slice = bySlice.get(key)!.sort(byScoreDescThenSizeAsc)
      let docs = 0
      let tokens = 0
      for (const s of slice) {
        if (docs > 0 && (docs >= reserve.maxDocs || tokens + s.tokens > reserve.maxTokens)) break
        if (alwaysTokens + reservedTokens + s.tokens > maxTokens) break
        reserved.push(s)
        docs++
        tokens += s.tokens
        reservedTokens += s.tokens
      }
    }
    if (reserved.length > 0) {
      const inReserve = new Set(reserved)
      eligible = eligible.filter((s) => !inReserve.has(s))
      floored = floored.filter((s) => !inReserve.has(s))
    }
  }

  const kept: ScoredItem[] = [...always, ...reserved]
  const pruned: ScoredItem[] = []
  let usedTokens = kept.reduce((sum, s) => sum + s.tokens, 0)

  for (const s of eligible) {
    if (kept.length === 0 || usedTokens + s.tokens <= maxTokens) {
      kept.push(s)
      usedTokens += s.tokens
    } else {
      pruned.push(s)
    }
  }

  return {
    kept: Object.freeze(kept),
    pruned: Object.freeze(pruned),
    floored: Object.freeze(floored),
    excluded: Object.freeze(excluded),
    reserved: Object.freeze(reserved),
    floorValue,
  }
}
