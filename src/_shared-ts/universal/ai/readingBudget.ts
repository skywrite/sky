/**
 * The reading budget — how much of the notebook a chat turn may assemble
 * into context — and what a model's window makes of it.
 *
 * Budgets come in stops, nothing first, so the same seven choices stand on
 * the page's slider and behind the terminal's flag. A profile may declare
 * the window its host serves in one request; the budget that fits leaves
 * room for the rest of the request — the system prompt and the tool
 * schemas, and the reply, which for a reasoning model includes its thinking
 * — and allows for the budget being an estimate at four characters a token,
 * which other tokenizers exceed. A budget the window cannot take drops to
 * the highest stop that fits. A profile with no window declared is not
 * capped.
 */

export const STOPS: readonly number[] = [0, 25_000, 50_000, 100_000, 300_000, 500_000, 750_000]

/** Tokens the system prompt and the tool schemas take, in round figures. */
export const PROMPT_AND_TOOLS_TOKENS = 16_000
/** Tokens kept for the reply, thinking included. */
export const REPLY_TOKENS = 16_000
/** How far a four-characters-a-token estimate may fall short of the host's count. */
export const ESTIMATE_SLACK = 1.25

/** The stop nearest a budget — a budget set elsewhere still sits somewhere on the slider. */
export function stopIndex(tokens: number): number {
  let nearest = 0
  for (let i = 1; i < STOPS.length; i++) {
    if (Math.abs(STOPS[i] - tokens) < Math.abs(STOPS[nearest] - tokens)) nearest = i
  }
  return nearest
}

/** The largest budget a window can take, or null when no window is declared. */
export function readingCap(contextWindow: number | undefined): number | null {
  if (contextWindow === undefined) return null
  const room = contextWindow - PROMPT_AND_TOOLS_TOKENS - REPLY_TOKENS
  return Math.max(0, Math.floor(room / ESTIMATE_SLACK))
}

/** The highest stop within a cap; nothing always fits. */
export function highestStop(cap: number): number {
  let stop = 0
  for (const candidate of STOPS) if (candidate <= cap) stop = candidate
  return stop
}

/** The last stop a window reaches — the slider's end; the final stop when no window is declared. */
export function reachIndex(contextWindow: number | undefined): number {
  const cap = readingCap(contextWindow)
  return cap === null ? STOPS.length - 1 : STOPS.indexOf(highestStop(cap))
}

/** A budget as a window takes it: unchanged when it fits, else the highest stop that does. */
export function fitBudget(tokens: number, contextWindow: number | undefined): number {
  const cap = readingCap(contextWindow)
  return cap === null || tokens <= cap ? tokens : highestStop(cap)
}
