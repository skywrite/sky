/**
 * Real tokens per estimated token.
 *
 * Every budget in the chat is an estimate at four characters a token. The
 * providers count differently: measured over 30 days to 2026-10-04, one
 * estimated token was 1.78 real tokens on Claude Opus 5, Opus 5.5 and Fable
 * 5.1, about 1.25 on Haiku 4.5, and 1.12 on GPT-6 Astra. A "300k" budget was
 * 535k on the wire; a 500k one sat at the 1M window. Neither tokenizer is
 * published, so the ratio is learned from what each call reports back —
 * seeded here per model family, then moved by observation.
 */

export interface TokenRatio {
  /** Real input tokens per estimated token */
  ratio: number
  /** Observations folded in so far */
  samples: number
  /** When the last observation landed, `YYYY-MM-DD HH:MM` in the notebook's zone or ISO */
  updated: string
}

/** The ratio for a model nothing has been observed on: the old fixed slack. */
export const DEFAULT_RATIO = 1.25

/** Below this estimated size a request's fixed overhead dominates the ratio; it is not a sample. */
export const MIN_RATIO_SAMPLE_TOKENS = 10_000

/** How far one observation moves the ratio. */
export const RATIO_ALPHA = 0.2

/** Ratios outside this range are a counting error, not a tokenizer. */
const RATIO_MIN = 0.5
const RATIO_MAX = 4

const SEEDS: ReadonlyArray<readonly [RegExp, number]> = [
  // The Opus 4.7 tokenizer family, Fable included — measured 1.78 median.
  [/^claude-(?:opus-5|fable-5|sonnet-5|opus-4-[78]|sonnet-4-[678])/, 1.75],
  [/^claude-haiku/, 1.25],
  [/^gpt-6/, 1.15],
]

/** The seed for a model id, else the default. */
export function seedRatio(modelId: string): number {
  for (const [pattern, ratio] of SEEDS) if (pattern.test(modelId)) return ratio
  return DEFAULT_RATIO
}

/**
 * Fold one observation into a record: the request's estimated size against
 * what the provider counted. A first observation replaces the seed outright
 * — the seed was a guess — later ones move it by RATIO_ALPHA. Requests under
 * MIN_RATIO_SAMPLE_TOKENS and ratios outside the sane range leave the record
 * as it was.
 */
export function observeRatio(
  previous: TokenRatio | undefined,
  estimated: number,
  real: number,
  updated: string,
): TokenRatio | undefined {
  if (estimated < MIN_RATIO_SAMPLE_TOKENS || real <= 0) return previous
  const observed = real / estimated
  if (observed < RATIO_MIN || observed > RATIO_MAX) return previous
  if (!previous || previous.samples === 0) return { ratio: round(observed), samples: 1, updated }
  return {
    ratio: round(previous.ratio + RATIO_ALPHA * (observed - previous.ratio)),
    samples: previous.samples + 1,
    updated,
  }
}

function round(ratio: number): number {
  return Math.round(ratio * 1000) / 1000
}
