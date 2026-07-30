/**
 * Shared ranking key for completions that come from more than one provider.
 */

/** Highest score this key can represent; anything above ranks equal to it. */
const MAX_SCORE = 99_999.9

/**
 * Turn a relevance score into a sortText key.
 *
 * People and organizations are contributed by two separately-registered
 * providers, and VS Code merges their items into one list. A key derived from
 * each provider's own position ("00000", "00001", ...) therefore cannot
 * interleave them — the top person and the top org both claim "00000". Deriving
 * the key from the score itself gives both providers a comparable scale, so a
 * heavily-used org outranks a barely-used person in a field like `rel:`.
 *
 * Higher score sorts first, since VS Code orders sortText ascending. Scores are
 * resolved to one decimal place, matching what the `Score:` detail displays;
 * ties fall through to VS Code's label comparison, which mirrors the
 * score-descending-then-name-ascending order the service already sorts by.
 *
 * Note that sortText only decides among items VS Code considers to match the
 * typed prefix equally well — its own match quality is applied first.
 */
export function scoreSortText(score: number): string {
  const bounded = Math.min(Math.max(score, 0), MAX_SCORE)
  const scaled = Math.round(bounded * 10)
  return String(999_999 - scaled).padStart(6, '0')
}
