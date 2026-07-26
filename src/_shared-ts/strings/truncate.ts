/**
 * Truncate to at most `max` UTF-16 code units without splitting a surrogate pair.
 *
 * A plain `slice(0, max)` cuts on a code-unit boundary, so a cut landing inside
 * an emoji keeps only its leading surrogate. `JSON.stringify` then escapes that
 * orphan as an unpaired `\uD83D`, and model APIs reject the whole request body
 * over it ("The request body is not valid JSON: no low surrogate in string") —
 * half an emoji in one truncated chat turn is enough to fail a context query.
 *
 * Only surrogate pairs are protected, because they are what makes the output
 * invalid. Sequences built from several code points (ZWJ emoji, flags,
 * combining marks) can still be cut mid-sequence — that tail renders oddly but
 * encodes fine. Text that already carries a lone surrogate passes through
 * untouched: this trims, it does not repair.
 *
 * @param text   Text to truncate
 * @param max    Maximum UTF-16 code units to keep, before `suffix`
 * @param suffix Appended only when `text` was actually truncated
 */
export default function truncate(text: string, max: number, suffix = ''): string {
  if (text.length <= max) return text

  // A high surrogate as the last kept unit has its pair in the dropped half,
  // so drop it too rather than strand it.
  const last = text.charCodeAt(max - 1)
  const end = last >= 0xd800 && last <= 0xdbff ? max - 1 : max

  return text.slice(0, Math.max(0, end)) + suffix
}
