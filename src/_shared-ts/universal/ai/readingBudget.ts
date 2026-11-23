/**
 * The reading budget — how much of the notebook a run may assemble into
 * context — and what a model's window makes of it.
 *
 * A budget is counted in the model's own tokens: the ones its window holds
 * and its usage reports. A profile may declare the window its host serves in
 * one request; what that leaves for reading is the rest once the system
 * prompt, the tool schemas and the reply — which for a reasoning model
 * includes its thinking — have their room (`readingCap`). A chat reads all of
 * it: nobody chooses a chat's budget. A command that asks for a budget of its
 * own keeps it when it fits and otherwise drops to the highest stop that does
 * (`fitBudget`). A profile with no window declared is not capped.
 *
 * The notebook is measured before any model sees it, at four characters a
 * token. A session converts between that estimate and the model's tokens
 * with the ratio learned per model (universal/ai/tokenRatio.ts): the
 * assembler reads `estimatedTokens(budget, ratio)` of text, and every count a
 * person reads is shown in the model's tokens.
 */

/** The sizes a fitted budget lands on, nothing first. */
export const STOPS: readonly number[] = [0, 25_000, 50_000, 100_000, 300_000, 500_000, 750_000]

/** Tokens the system prompt and the tool schemas take, in round figures. */
export const PROMPT_AND_TOOLS_TOKENS = 16_000
/** Tokens kept for the reply, thinking included. */
export const REPLY_TOKENS = 16_000
/** How far a four-characters-a-token estimate may fall short of the host's count, for a model with no learned ratio. */
export const ESTIMATE_SLACK = 1.25

/** The largest budget a window can take, or null when no window is declared. */
export function readingCap(contextWindow: number | undefined): number | null {
  if (contextWindow === undefined) return null
  return Math.max(0, contextWindow - PROMPT_AND_TOOLS_TOKENS - REPLY_TOKENS)
}

/** The highest stop within a cap; nothing always fits. */
export function highestStop(cap: number): number {
  let stop = 0
  for (const candidate of STOPS) if (candidate <= cap) stop = candidate
  return stop
}

/** A budget as a window takes it: unchanged when it fits, else the highest stop that does. */
export function fitBudget(tokens: number, contextWindow: number | undefined): number {
  const cap = readingCap(contextWindow)
  return cap === null || tokens <= cap ? tokens : highestStop(cap)
}

/** The notebook text a count of the model's tokens holds, at four characters a token. `ratio` is the model's tokens per estimated one. */
export function estimatedTokens(tokens: number, ratio: number): number {
  return Math.floor(tokens / ratio)
}

/** A four-characters-a-token estimate in the model's tokens. */
export function modelTokens(estimated: number, ratio: number): number {
  return Math.round(estimated * ratio)
}
