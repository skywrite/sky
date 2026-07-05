import {
  Collection,
  type CollectionItem,
  type Document,
  type MarkdownOutputOptions,
} from '#shared/models/Markdown/mod.ts'
import type DomainCollection from '#shared/models/DomainCollection/mod.ts'

/**
 * Scores a single document for relevance/priority.
 * Higher = more important = kept first when budget is tight.
 * See `scorers.ts` for the default implementation.
 */
export type Scorer = (item: CollectionItem<Document>) => number

/** A document annotated with its computed score and estimated token cost. */
export interface ScoredItem {
  item: CollectionItem<Document>
  /** Relevance score from the Scorer function. Higher = more important. */
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
 * 1. **Scores** each document using a pluggable Scorer function
 * 2. **Sorts** by score descending (ties broken by smaller doc first)
 * 3. **Partitions** into "kept" and "pruned" lists based on a token budget
 *
 * The result is two lists:
 * - `kept`   — the highest-scored documents that fit within the token budget
 * - `pruned` — everything that didn't fit, in score order
 *
 * ## Immutability
 *
 * Every instance is immutable. The `with*()` methods return NEW instances
 * with the changed parameter — the original is never modified.
 *
 * - `withBudget(n)` — re-partitions the SAME scored items with a new budget
 *   (cheap: no re-scoring, just re-splitting the sorted list)
 * - `withCollection(c)` / `withScorer(s)` — re-scores from scratch
 *   (scores depend on the collection/scorer, so they must be recomputed)
 *
 * ## Token budget
 *
 * The budget is a soft cap. The first item is ALWAYS kept regardless of size
 * so that the assembler never produces empty output for a non-empty collection.
 * After the first item, documents are greedily added until the budget is
 * exceeded, then the rest go into `pruned`.
 *
 * ## Usage
 *
 * ```ts
 * const asm = ContextAssembler.from(collection, {
 *   scorer: createRecencyTypeScorer(today),
 *   maxTokens: 4000,
 * })
 *
 * asm.kept       // highest-priority docs that fit
 * asm.pruned     // docs that didn't fit
 * asm.overBudget // true if even the kept items exceed maxTokens
 *                // (only happens when a single item is bigger than the budget)
 * asm.toMarkdown() // render kept docs as markdown for an AI prompt
 * ```
 */
export default class ContextAssembler {
  // --- Internal state (all frozen/readonly) ---

  private readonly _kept: readonly ScoredItem[]
  private readonly _pruned: readonly ScoredItem[]
  private readonly _totalTokens: number

  // These are stored so with*() methods can derive new instances
  private readonly _scorer: Scorer
  private readonly _maxTokens: number
  private readonly _collection: DomainCollection

  private constructor(
    kept: readonly ScoredItem[],
    pruned: readonly ScoredItem[],
    scorer: Scorer,
    maxTokens: number,
    collection: DomainCollection,
  ) {
    this._kept = kept
    this._pruned = pruned
    this._totalTokens = kept.reduce((sum, s) => sum + s.tokens, 0)
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
   * This is the main entry point. It scores every document, sorts them,
   * and splits into kept/pruned based on the token budget.
   *
   * @param maxTokens - Token budget. Defaults to Infinity (keep everything).
   */
  static from(collection: DomainCollection, opts: { scorer: Scorer; maxTokens?: number }): ContextAssembler {
    const { scorer, maxTokens = Infinity } = opts
    const scored = scoreAndSort(collection, scorer)
    const [kept, pruned] = splitByBudget(scored, maxTokens)
    return new ContextAssembler(kept, pruned, scorer, maxTokens, collection)
  }

  // ---------------------------------------------------------------------------
  // Read state
  // ---------------------------------------------------------------------------

  /** Documents that fit within the token budget, sorted by score descending. */
  get kept(): readonly ScoredItem[] {
    return this._kept
  }

  /** Documents that were cut to stay within budget, in score order. */
  get pruned(): readonly ScoredItem[] {
    return this._pruned
  }

  /** Sum of estimated tokens across all kept documents. */
  get totalTokens(): number {
    return this._totalTokens
  }

  /**
   * True if totalTokens exceeds maxTokens.
   * This only happens when even a single document is larger than the budget
   * (because we always keep at least one).
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
   * Re-partitions the same scored items — does NOT re-score. This means
   * tightening the budget prunes more items, loosening it recovers them.
   */
  withBudget(maxTokens: number): ContextAssembler {
    // Recombine kept + pruned, re-sort, re-split with the new budget
    const all = [...this._kept, ...this._pruned].sort(byScoreDescThenSizeAsc)
    const [kept, pruned] = splitByBudget(all, maxTokens)
    return new ContextAssembler(kept, pruned, this._scorer, maxTokens, this._collection)
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

/**
 * Score every item in the collection and sort by relevance.
 * Each item gets its score from the scorer and its token cost estimated
 * from the rendered markdown length.
 */
function scoreAndSort(collection: DomainCollection, scorer: Scorer): ScoredItem[] {
  return collection.allItems
    .map((item) => ({
      item,
      score: scorer(item),
      tokens: estimateTokens(item.doc.toMarkdown()),
    }))
    .sort(byScoreDescThenSizeAsc)
}

/**
 * Sort comparator: highest score first. On ties, prefer the smaller document
 * (fewer tokens) since it preserves more budget for other items.
 *
 * Compares with explicit inequality rather than subtraction: `b.score - a.score`
 * is NaN when both scores are Infinity (two pinned items, see withPinnedPaths)
 * or both -Infinity (two always-prune items), and a NaN comparator result is
 * undefined behavior for Array.prototype.sort.
 */
function byScoreDescThenSizeAsc(a: ScoredItem, b: ScoredItem): number {
  if (a.score !== b.score) return a.score < b.score ? 1 : -1
  return a.tokens - b.tokens
}

/**
 * Split a sorted list of scored items into [kept, pruned] based on a token budget.
 *
 * Greedy algorithm: walk the list in score order, accumulating tokens.
 * Each item is kept if adding it stays within budget, otherwise pruned.
 *
 * Special rule: the FIRST item is always kept regardless of size. This
 * prevents returning empty output when a single document exceeds the budget.
 * (The caller can check `overBudget` to detect this case.)
 *
 * Both returned arrays are frozen to enforce immutability.
 */
function splitByBudget(sorted: ScoredItem[], maxTokens: number): [readonly ScoredItem[], readonly ScoredItem[]] {
  if (sorted.length === 0) return [Object.freeze([]), Object.freeze([])]

  const kept: ScoredItem[] = []
  const pruned: ScoredItem[] = []
  let usedTokens = 0

  for (const item of sorted) {
    // Always keep at least one item, even if it alone exceeds the budget
    if (kept.length === 0 || usedTokens + item.tokens <= maxTokens) {
      kept.push(item)
      usedTokens += item.tokens
    } else {
      pruned.push(item)
    }
  }

  return [Object.freeze(kept), Object.freeze(pruned)]
}
