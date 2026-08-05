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
 * The result is three lists:
 * - `kept`     — pinned documents plus the highest-scored ones that fit the budget
 * - `pruned`   — eligible documents that didn't fit (budget's fault; recoverable)
 * - `excluded` — documents the scorer banned outright (intent's fault; never recovered)
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
  private readonly _excluded: readonly ScoredItem[]
  private readonly _totalTokens: number

  // These are stored so with*() methods can derive new instances
  private readonly _scorer: Scorer
  private readonly _maxTokens: number
  private readonly _collection: DomainCollection

  private constructor(parts: Partitioned, scorer: Scorer, maxTokens: number, collection: DomainCollection) {
    this._kept = parts.kept
    this._pruned = parts.pruned
    this._excluded = parts.excluded
    this._totalTokens = parts.kept.reduce((sum, s) => sum + s.tokens, 0)
    this._scorer = scorer
    this._maxTokens = maxTokens
    this._collection = collection
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Build a ContextAssembler from a DomainCollection.
   *
   * This is the main entry point. It scores every document, partitions by
   * verdict, and budget-walks the scored bucket.
   *
   * @param maxTokens - Token budget. Defaults to Infinity (keep everything eligible).
   */
  static from(collection: DomainCollection, opts: { scorer: Scorer; maxTokens?: number }): ContextAssembler {
    const { scorer, maxTokens = Infinity } = opts
    const items = scoreItems(collection, scorer)
    return new ContextAssembler(partition(items, maxTokens), scorer, maxTokens, collection)
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

  /** Documents excluded by scorer verdict (`keep: 'never'`), regardless of budget. */
  get excluded(): readonly ScoredItem[] {
    return this._excluded
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
    const all = [...this._kept, ...this._pruned, ...this._excluded]
    return new ContextAssembler(partition(all, maxTokens), this._scorer, maxTokens, this._collection)
  }

  /**
   * Return a new ContextAssembler with a different collection.
   * Re-scores from scratch (new docs need new scores).
   */
  withCollection(collection: DomainCollection): ContextAssembler {
    return ContextAssembler.from(collection, { scorer: this._scorer, maxTokens: this._maxTokens })
  }

  /**
   * Return a new ContextAssembler with a different scorer.
   * Re-scores from scratch (different scorer = different scores).
   */
  withScorer(scorer: Scorer): ContextAssembler {
    return ContextAssembler.from(this._collection, { scorer, maxTokens: this._maxTokens })
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
  excluded: readonly ScoredItem[]
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
 * Partition scored items by verdict, then budget-walk the scored bucket.
 *
 * The single partition implementation shared by `from()` and `withBudget()`,
 * so construction and re-budgeting cannot disagree about verdict semantics:
 * - `always` → kept unconditionally, first, counted against the budget
 * - `never`  → excluded unconditionally, regardless of available room
 * - `scored` → sorted by score desc, kept while the budget allows
 *
 * Among scored items, at least one is kept even if it alone exceeds the
 * budget (never produce empty output when eligible items exist).
 */
function partition(items: ScoredItem[], maxTokens: number): Partitioned {
  const always: ScoredItem[] = []
  const eligible: ScoredItem[] = []
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

  const kept: ScoredItem[] = [...always]
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
    excluded: Object.freeze(excluded),
  }
}
