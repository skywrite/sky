/**
 * The format law for AI-written profile text: the knobs and the mechanics
 * behind "every line reads at a glance". Which ops exist and where lines
 * land is write.ts's business; the reasoning is docs/README.md. Change a
 * constant here and the distiller's schema, its prompt, and the applier
 * all follow.
 */

/** Words a line may hold before the applier refuses it. Counted on whitespace. */
export const MAX_WORDS_PER_LINE = 15

/** Lines an Overview may hold: the whole "who is this" at a glance. */
export const MAX_OVERVIEW_LINES = 6

/** A line that is only a section name is a heading echo, never a fact. */
const SECTION_NAMES = new Set(['overview', 'background', 'family', 'info'])

/**
 * Words that end in a period without ending a sentence. Lowercase, no dot.
 * Single initials ("J.") and dotted forms ("U.S.", "e.g.", "p.m.") are
 * recognized by shape instead. Company suffixes (Inc., Corp.) are left
 * out on purpose: they usually do end the sentence.
 */
const ABBREVIATIONS = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'jr',
  'sr',
  'st',
  'mt',
  'ft',
  'vs',
  'etc',
  'no',
  'approx',
  'dept',
  'est',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
])

/** A list marker: `- `, `* `, `+ `, `1. `, `12) `. Two digits at most, so a year never counts. */
const BULLET = /^\s*(?:[-*+]|\d{1,2}[.)])\s+/
const HEADING = /^\s*#+\s/
/** End of a sentence followed by the start of another: punctuation, space, capital or digit. */
const SENTENCE_END = /(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])/

export function wordCount(line: string): number {
  const text = line.trim()
  return text ? text.split(/\s+/).length : 0
}

export function isBullet(line: string): boolean {
  return BULLET.test(line)
}

export function unbullet(line: string): string {
  return line.replace(BULLET, '').trim()
}

export function bullet(line: string): string {
  return `- ${line}`
}

/**
 * The comparison key for dedupe and replace-by-quote: list marker, case,
 * and a terminal period or bang are ignored, so "Partner: Jordan" and
 * "- Partner: Jordan." are the same line.
 */
export function lineKey(line: string): string {
  return unbullet(line)
    .replace(/[.!]+$/, '')
    .trim()
    .toLowerCase()
}

/**
 * Model text → fact lines. Heading lines and heading echoes drop; each
 * remaining line splits on semicolons and sentence ends, so two facts the
 * model chained arrive as two lines. Nothing is reworded beyond a capital
 * on a cut piece, and whether a line fits the cap is the caller's call
 * (see overCap).
 */
export function toFactLines(text: string | string[]): string[] {
  const chunks = Array.isArray(text) ? text : [text]
  const out: string[] = []
  for (const chunk of chunks) {
    for (const line of chunk.replace(/\r/g, '').split('\n')) {
      if (HEADING.test(line)) continue
      const cleaned = unbullet(line)
      if (!cleaned) continue
      for (const piece of splitFacts(cleaned)) {
        if (SECTION_NAMES.has(piece.toLowerCase().replace(/[.:]$/, ''))) continue
        out.push(piece)
      }
    }
  }
  return out
}

/** The first line over the cap, for the skip reason; undefined when all fit. */
export function overCap(lines: string[]): string | undefined {
  return lines.find((line) => wordCount(line) > MAX_WORDS_PER_LINE)
}

function splitFacts(line: string): string[] {
  return line
    .split(/;\s+/)
    .flatMap(splitSentences)
    .map((s) => capitalize(s.trim()))
    .filter(Boolean)
}

/**
 * A piece cut from the middle of a chain starts lowercase. It gets a
 * capital only when its second letter is lowercase too, so a brand or
 * handle that starts that way (iPhone, eBay) keeps its spelling.
 */
function capitalize(text: string): string {
  return /^[a-z][a-z]/.test(text) ? text[0].toUpperCase() + text.slice(1) : text
}

function splitSentences(text: string): string[] {
  const merged: string[] = []
  for (const part of text.split(SENTENCE_END)) {
    const last = merged.length - 1
    if (last >= 0 && endsWithAbbreviation(merged[last])) merged[last] = `${merged[last]} ${part}`
    else merged.push(part)
  }
  return merged
}

function endsWithAbbreviation(text: string): boolean {
  const match = text.match(/(\S+)[.!?]["')\]]?$/)
  if (!match) return false
  const word = match[1].replace(/^["'(\[]+/, '')
  if (/^[A-Za-z]$/.test(word)) return true
  if (/^[A-Za-z](?:\.[A-Za-z])+$/.test(word)) return true
  return ABBREVIATIONS.has(word.toLowerCase())
}
