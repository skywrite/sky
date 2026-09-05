/**
 * Token counts as the invoice bills them: input at the full rate, input
 * read from the prompt cache, input written to it, and output. One call's
 * counts or a turn's summed — the shape is the same, and it has no dollars:
 * tokens by model are what the bill is computed from, and the cache share
 * is what says whether a caching fix worked.
 */
export interface TokenUsage {
  /** Input tokens billed at the full rate: neither read from nor written to the cache */
  input: number
  /** Input tokens served from the prompt cache */
  cacheRead: number
  /** Input tokens written to the prompt cache */
  cacheWrite: number
  /** Output tokens, reasoning included */
  output: number
}

export const NO_USAGE: TokenUsage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  }
}

/** Everything the model read: full-rate input, cache reads, and cache writes. */
export function totalInput(usage: TokenUsage): number {
  return usage.input + usage.cacheRead + usage.cacheWrite
}

/** `312000` → `312k`, `4120` → `4.1k`, `980` → `980`, `1200000` → `1.2M`. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

/** The line under a reply: `312k in · 298k from cache · 4.1k out · Claude Opus 5`. */
export function usageLine(usage: TokenUsage, model?: string): string {
  const parts = [
    `${formatTokens(totalInput(usage))} in`,
    `${formatTokens(usage.cacheRead)} from cache`,
    `${formatTokens(usage.output)} out`,
  ]
  if (model) parts.push(model)
  return parts.join(' · ')
}
