/**
 * The chat-only relevance score — Stage 2 of the context-quality ladder.
 *
 * ai:chat's old ranking was the shared recency+type prior plus a binary
 * +10 for every query-returned path. Two real 300k chats showed where
 * that breaks: the +10 is all-or-nothing (a doc matched by a 400-result
 * body sweep outranks everything, an on-topic doc the queries missed
 * outranks nothing), and under budget pressure the recency prior prunes
 * by type — people cards of the very people under discussion died while
 * a week of unrelated messages survived.
 *
 * The composed score keeps the shared prior as the ambient base and adds
 * two evidence terms, hand-weighted and inspectable in the context log:
 *
 *   score = recency+type prior (≤10, shared scorer, penalties included)
 *         + lexical            (0–8: the doc mentions what the
 *                               conversation is about)
 *         + provenance         (0–11: how deliberately queries
 *                               retrieved it)
 *
 * Embeddings were considered and deferred: the observed failure mode is
 * ranking, not semantic recall, and a scalar the log can explain wins on
 * debuggability.
 */

import { estimateTokens, type Scorer, scored } from '#shared/models/AI/ContextAssembler/mod.ts'
import { createRecencyTypeScorer } from '#shared/models/AI/ContextAssembler/scorers.ts'
import type DomainCollection from '#shared/models/DomainCollection/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { RetrievalTier } from '../document/ContextLog/mod.ts'

// -----------------------------------------------------------------------------
// Weights — every tunable in one place, whole numbers where possible
// -----------------------------------------------------------------------------

export const CHAT_SCORE = {
  /** Result-set sizes at or under these count as targeted/medium; larger = broad. */
  tierMaxResults: { targeted: 25, medium: 150 },
  /** Provenance boost by tier — targeted retrieval keeps the old +10's strength. */
  tierBoost: { targeted: 10, medium: 7, broad: 4 } as Record<RetrievalTier, number>,
  /** Extra evidence when two or more distinct query executions returned the doc. */
  multiHitBonus: 1,
  /** Ceiling of the lexical component. */
  lexicalMax: 8,
  /** Body-occurrence density (per 1k tokens) that earns full term credit. */
  fullCreditDensity: 2,
  /**
   * Body-channel damping. The authored header fields — rel, tags,
   * summary, title — are the strong topical signals; body text is the
   * tiebreaker, not the driver.
   */
  bodyWeight: 0.5,
  /** Docs measure as at least this long — a mention in a tiny doc is its subject. */
  minDocTokens: 200,
  /** Terms this short match whole words only; longer terms match substrings. */
  wordBoundaryMax: 4,
  /** A doc's lexical evidence comes from its strongest matches only. */
  maxEvidenceTerms: 5,
  /** Terms beyond this are dropped — bounds the per-rebuild scan cost. */
  maxTerms: 64,
  /**
   * Relevance floor: scored docs below this fraction of the turn's top
   * score are cut regardless of budget room — context sizes to the
   * question instead of filling to the cap. Adapts by construction: a
   * strong-evidence turn floors high and sheds ambient chatter, a
   * no-evidence turn (top ~8) floors low and keeps the baseline.
   */
  floorFraction: 0.35,
} as const

/**
 * Scoring-semantics tag recorded in each turn's stats. Bump when the
 * score composition or weights change materially — logged scores are only
 * interpretable against the semantics that produced them ('s3' = composed
 * scorer + relevance floor).
 */
export const SCORING = 's3'

// -----------------------------------------------------------------------------
// Provenance — retrieval evidence accumulated by ChatContext
// -----------------------------------------------------------------------------

/** How a query-retrieved doc earned its place in the universe. */
export interface DocProvenance {
  /** Strongest evidence seen: how selective the returning result set was. */
  tier: RetrievalTier
  /** Distinct query executions that returned this doc. */
  hits: number
  /** Turn of the most recent retrieval. */
  lastHitTurn: number
}

/**
 * Selectivity is the evidence: a query that returned 8 paths says far more
 * about each of them than a body sweep that returned 400.
 */
export function tierForResultSize(resultSize: number): RetrievalTier {
  if (resultSize <= CHAT_SCORE.tierMaxResults.targeted) return 'targeted'
  if (resultSize <= CHAT_SCORE.tierMaxResults.medium) return 'medium'
  return 'broad'
}

const TIER_RANK: Record<RetrievalTier, number> = { targeted: 2, medium: 1, broad: 0 }

export function strongerTier(a: RetrievalTier, b: RetrievalTier): RetrievalTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

export function provenanceBoost(prov: DocProvenance | undefined): number {
  if (!prov) return 0
  return CHAT_SCORE.tierBoost[prov.tier] + (prov.hits >= 2 ? CHAT_SCORE.multiHitBonus : 0)
}

// -----------------------------------------------------------------------------
// Topic terms — what the conversation is currently about
// -----------------------------------------------------------------------------

/** Function words and chat-generic time/verb words that carry no topic signal. */
const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'all',
  'also',
  'and',
  'any',
  'are',
  'ask',
  'been',
  'before',
  'being',
  'but',
  'can',
  'could',
  'day',
  'days',
  'did',
  'does',
  'doing',
  'down',
  'else',
  'ever',
  'for',
  'from',
  'get',
  'give',
  'had',
  'has',
  'have',
  'her',
  'him',
  'his',
  'how',
  'into',
  'its',
  'just',
  'know',
  'last',
  'let',
  'like',
  'made',
  'make',
  'many',
  'may',
  'month',
  'more',
  'most',
  'much',
  'need',
  'new',
  'not',
  'now',
  'off',
  'one',
  'only',
  'other',
  'our',
  'out',
  'over',
  'please',
  'recent',
  'recently',
  'said',
  'same',
  'see',
  'she',
  'should',
  'show',
  'some',
  'tell',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'today',
  'told',
  'too',
  'use',
  'was',
  'week',
  'weeks',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'yes',
  'yesterday',
  'you',
  'your',
])

const YEAR = /^\d{4}$/
const COMBINING_MARKS = /[\u0300-\u036f]/g

/**
 * Lowercase and strip accents, so "Núñez" and "nunez" are one string.
 *
 * The tokenizer splits on everything outside [a-z0-9], which makes an
 * accent a separator INSIDE a word: "Núñez" produced no terms at all
 * (every fragment fell under the length floor) and "José" produced the
 * junk fragment "jos". Folding first makes the alphabet match the
 * intent — split on non-letters, not on non-ASCII-letters.
 *
 * Apply symmetrically: to the terms AND to every channel they are
 * matched against. Folding one side alone would stop folded terms from
 * matching unfolded document text at all — strictly worse than the bug.
 *
 * Two gaps left open, both questions about the tokenizer's alphabet
 * rather than this correction: ß does not decompose under NFD, and
 * non-Latin scripts are still dropped wholesale by the split.
 */
function fold(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase()
}

/** Content words: 3+ letters and not a stopword; among numbers only years survive. */
function termsFrom(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => YEAR.test(t) || (t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS.has(t)))
}

const QUOTED = /"((?:[^"\\]|\\.)*)"/g

/**
 * The conversation's topic vocabulary: content words from the user's
 * recent messages (newest first, so the cap trims the oldest) plus the
 * string literals of the active queries. Query literals are the
 * distilled topic — the tags, aliases, and name fragments the query
 * producer chose — while unquoted GraphQL field names stay out. Dropped
 * queries and messages leaving the window drop their terms, so the set
 * tracks conversation drift.
 */
export function extractTopicTerms(userMessage: string | undefined, queries: string[]): string[] {
  const raw: string[] = []
  if (userMessage) raw.push(...termsFrom(userMessage))
  for (const q of queries) {
    for (const m of q.matchAll(QUOTED)) raw.push(...termsFrom(m[1]))
  }
  const seen = new Set<string>()
  const terms: string[] = []
  for (const t of raw) {
    if (seen.has(t)) continue
    seen.add(t)
    terms.push(t)
  }
  return terms.slice(0, CHAT_SCORE.maxTerms)
}

// -----------------------------------------------------------------------------
// Lexical component
// -----------------------------------------------------------------------------

/**
 * Lexical topic match, BM25-shaped but hand-rolled for interpretability.
 *
 * Header channels dominate. Per term a doc earns the best evidence
 * across its authored metadata — `rel:` (deliberate linkage: rel
 * containing the org under discussion is as strong as signals get),
 * `tags:` (curated taxonomy), `summary:` (the one-line abstract) — and
 * its BODY, damped by bodyWeight: occurrence DENSITY (a passing mention
 * in a long document is weak, the same mention in a short one is the
 * document's subject — BM25's length normalization in interpretable
 * form; without it, long recent messages that graze many terms
 * out-accumulate the short entity cards the topic is actually about).
 *
 * Every channel hit is scaled by the term's RARITY measured WITHIN that
 * channel — log(N/df)/log(N), 1 for a term matching one doc, 0 for one
 * matching all. Per-channel df matters: a term saturating message
 * bodies can still be a precise signal in the handful of docs whose
 * rel or tags carry it.
 *
 * The doc additionally earns one NAME evidence: the fraction of its
 * title's content words the terms cover. Full coverage means the doc IS
 * the thing the conversation names ("Jane-Doe.md" against terms
 * jane+doe) and counts as full credit regardless of df — rarity must
 * not dilute the entity card itself. Partial coverage (one word of a
 * six-word message title) stays proportionally weak.
 *
 * The doc's strongest maxEvidenceTerms evidences accumulate noisy-or
 * (1 − Π(1 − evidence)) and scale to lexicalMax: one perfect hit is
 * full credit alone, a handful of good matches approach it, and two
 * dilutions are refused by construction — dividing by the term count
 * would let a 30-term conversation dilute a doc fully matching the two
 * terms naming it, and unbounded accumulation would let a message
 * grazing fifteen weak terms outrank it.
 *
 * Long terms match substrings — plural/stem tolerance ("milestone" hits
 * "milestones") without a stemmer. Short terms (names, initialisms)
 * match whole words only: as substrings they hide inside unrelated
 * words ("jan" in "january"), which both misses the signal and inflates
 * df until the term weighs nothing.
 *
 * Cost: one lowercased render per doc plus terms×docs regex scans per
 * rebuild — sub-second at a 300-doc universe, bounded by maxTerms.
 */
function createLexicalScorer(collection: DomainCollection, terms: string[]): (path: string) => number {
  if (terms.length === 0) return () => 0

  // Terms are alphanumeric by construction (termsFrom splits on
  // everything else), so they embed into regexes without escaping.
  const matchers = terms.map((term) => {
    const source = term.length <= CHAT_SCORE.wordBoundaryMax ? `\\b${term}\\b` : term
    return { probe: new RegExp(source), counter: new RegExp(source, 'g') }
  })

  // A doc's name words: the filename's content words, with the routing
  // segments of message filenames ('slack_Sender-to-channel_…') dropped
  // first — they name senders and channels, not subjects.
  const nameWords = (p: string) => {
    const title = p
      .slice(p.lastIndexOf('/') + 1)
      .toLowerCase()
      .replace(/\.md$/, '')
      .split('_')
      .filter((seg) => !seg.includes('-to-'))
      .join(' ')
      .replace(/-/g, ' ')
    return termsFrom(title)
  }

  // Header channels come from the parsed frontmatter, body from the
  // yaml-stripped render — a rel/tags hit must not double-count as body
  // text, and the old flat-text scan actively PENALIZED header hits (one
  // rel: line in a 5k-token meeting scored as a passing mention).
  const HEADER_CHANNELS = ['rel', 'tags', 'summary'] as const
  type HeaderChannel = (typeof HEADER_CHANNELS)[number]

  const texts = new Map<
    string,
    { header: Record<HeaderChannel, string>; body: string; names: string[]; tokens: number }
  >()
  for (const item of collection.allItems) {
    const body = fold(item.doc.toMarkdown({ yaml: false }))
    texts.set(item.path, {
      header: {
        rel: fold([...item.doc.rel].join('\n')),
        tags: fold(String(item.doc.tags)),
        summary: fold(String(item.doc.yaml['summary'] ?? '')),
      },
      body,
      names: nameWords(item.path),
      tokens: Math.max(estimateTokens(body), CHAT_SCORE.minDocTokens),
    })
  }

  const docCount = texts.size
  if (docCount <= 1) return () => 0
  const logN = Math.log(docCount)
  const rarity = (df: number) => (df === 0 ? 0 : Math.log(docCount / df) / logN)

  const weighted = matchers.map(({ probe, counter }) => {
    const dfs: Record<HeaderChannel | 'body', number> = { rel: 0, tags: 0, summary: 0, body: 0 }
    for (const t of texts.values()) {
      for (const c of HEADER_CHANNELS) {
        if (probe.test(t.header[c])) dfs[c]++
      }
      if (probe.test(t.body)) dfs.body++
    }
    return {
      probe,
      counter,
      rarities: {
        rel: rarity(dfs.rel),
        tags: rarity(dfs.tags),
        summary: rarity(dfs.summary),
        body: rarity(dfs.body),
      },
    }
  })

  return (path: string) => {
    const t = texts.get(path)
    if (!t) return 0
    const evidences: number[] = []
    let namesMatched = 0
    for (const w of t.names) {
      if (matchers.some(({ probe }) => probe.test(w))) namesMatched++
    }
    if (namesMatched > 0) evidences.push(namesMatched / t.names.length)
    for (const { probe, counter, rarities } of weighted) {
      let evidence = 0
      for (const c of HEADER_CHANNELS) {
        if (rarities[c] > evidence && probe.test(t.header[c])) evidence = rarities[c]
      }
      if (rarities.body > 0) {
        const density = (countMatches(t.body, counter) / t.tokens) * 1000
        evidence = Math.max(
          evidence,
          Math.min(density / CHAT_SCORE.fullCreditDensity, 1) * rarities.body * CHAT_SCORE.bodyWeight,
        )
      }
      if (evidence > 0) evidences.push(evidence)
    }
    let miss = 1
    for (const e of evidences.sort((a, b) => b - a).slice(0, CHAT_SCORE.maxEvidenceTerms)) {
      miss *= 1 - e
    }
    return CHAT_SCORE.lexicalMax * (1 - miss)
  }
}

function countMatches(text: string, counter: RegExp, cap = 32): number {
  counter.lastIndex = 0
  let count = 0
  while (count < cap && counter.exec(text) !== null) count++
  return count
}

// -----------------------------------------------------------------------------
// The composed scorer
// -----------------------------------------------------------------------------

export interface ChatScorerOptions {
  today: PlainDate
  /** The universe being scored — lexical rarity is computed across it. */
  collection: DomainCollection
  terms: string[]
  provenance: ReadonlyMap<string, DocProvenance>
}

/**
 * Compose the shared recency+type prior with the chat evidence terms.
 * Non-scored verdicts (the transitive-org exclusion) pass through
 * untouched, so the shared scorer stays the single owner of hard rules.
 */
export function createChatScorer(opts: ChatScorerOptions): {
  scorer: Scorer
  /** Lexical component per scored path, filled as the assembler scores — for the log. */
  lexicalByPath: ReadonlyMap<string, number>
} {
  const base = createRecencyTypeScorer(opts.today)
  const lexical = createLexicalScorer(opts.collection, opts.terms)
  const lexicalByPath = new Map<string, number>()

  const scorer: Scorer = (item) => {
    const ambient = base(item)
    if (ambient.keep !== 'scored') return ambient
    const lex = lexical(item.path)
    lexicalByPath.set(item.path, lex)
    return scored(ambient.score + lex + provenanceBoost(opts.provenance.get(item.path)))
  }

  return { scorer, lexicalByPath }
}
