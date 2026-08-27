/**
 * Plain-text transcripts — what `--from-text` ingests: a notetaker's "copy
 * transcript" paste saved as .txt, one speaker turn per line, each optionally
 * anchored with a start stamp:
 *
 *   [0:03] Jane Doe: Okay, let's get started.
 *   [1:12:40] John Smith: One last thing before we wrap.
 *
 * That is already the turn text the VTT/SRT parsers build for the models, so
 * the content passes through untouched — no parse, no re-flow. The stamps are
 * read only for the meeting length. The flag owns .txt and nothing else:
 * wrapped transcripts (.rtf from TextEdit, .docx) are refused upstream, never
 * unwrapped here.
 */

/** `[m:ss]` or `[h:mm:ss]` at the head of a line; minutes are uncapped since some tools write `[75:30]` */
const STAMP_RE = /^[ \t]*\[(\d+):(\d{2})(?::(\d{2}))?\]/gm

/** RTF announces itself in its first bytes — a renamed .rtf is still RTF */
export function isRtf(text: string): boolean {
  return text.trimStart().startsWith('{\\rtf')
}

/** Turn start stamps in file order, as seconds. Lines without one are skipped. */
export function turnStamps(text: string): number[] {
  const stamps: number[] = []
  for (const [, a, b, c] of text.matchAll(STAMP_RE)) {
    const [h, m, s] = c === undefined ? [0, Number(a), Number(b)] : [Number(a), Number(b), Number(c)]
    stamps.push(h * 3600 + m * 60 + s)
  }
  return stamps
}

/**
 * Meeting length in whole minutes from the latest start stamp, rounded up: the
 * stamp is where the last turn begins, and the words after it still took time.
 * Null without stamps — the caller falls back to an explicit --duration.
 */
export function stampedDurationMinutes(stamps: readonly number[]): number | null {
  if (stamps.length === 0) return null
  const latest = stamps.reduce((max, s) => Math.max(max, s), 0)
  return Math.ceil(latest / 60)
}
