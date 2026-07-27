/**
 * The per-turn context log ai:chat appends to saved transcripts as trailing
 * HTML comments — one `<!-- TURN N ... -->` block per turn after the
 * conversation body, recording what the context pipeline did each turn.
 * Resume depends on it: the recorded universe (turn-1 CONTEXT plus DIFFs)
 * and QUERIES are what let a later session restore the chat's context state
 * instead of re-deriving it.
 *
 * `serializeContextLog` must stay byte-identical to what ai:chat has always
 * written — every saved chat in the notebook is in this exact format, and
 * `body + serializeContextLog(entries) === markdown` must hold for any file
 * the writer produced (the round-trip law the tests pin down).
 *
 * Files on disk may additionally have been whitespace-normalized after the
 * fact (line-trailing spaces stripped, final newline collapsed) — the parser
 * tolerates that losslessly, and for such files the law holds modulo the
 * same normalization.
 */

export interface ContextTurnLog {
  turn: number
  queries: string[]
  context?: string[] // full context list (turn 1 only)
  diff?: string[] // files added to universe
  pruned: string[] // eligible files cut by the token budget
  excluded?: string[] // files excluded by scorer verdict (with reasons)
  errors?: string[] // context queries that failed this turn (also in ai-errors.jsonl)
}

export function serializeContextLog(entries: ContextTurnLog[]): string {
  if (entries.length === 0) return ''

  let comment = '\n\n\n\n\n\n\n\n'
  for (const entry of entries) {
    comment += `<!-- TURN ${entry.turn}\n`
    if (entry.queries.length > 0) {
      comment += 'QUERIES:\n' + entry.queries.map((q) => ` - ${q}`).join('\n') + '\n'
    }
    if (entry.context) {
      comment += 'CONTEXT:\n' + entry.context.map((p) => ` - ${p}`).join('\n') + '\n'
    }
    if (entry.diff && entry.diff.length > 0) {
      comment += 'DIFF:\n' + entry.diff.map((p) => ` + ${p}`).join('\n') + '\n'
    }
    if (entry.pruned.length > 0) {
      comment += 'PRUNED:\n' + entry.pruned.map((p) => ` - ${p}`).join('\n') + '\n'
    }
    if (entry.excluded && entry.excluded.length > 0) {
      comment += 'EXCLUDED:\n' + entry.excluded.map((p) => ` - ${p}`).join('\n') + '\n'
    }
    if (entry.errors && entry.errors.length > 0) {
      comment += 'ERRORS:\n' + entry.errors.map((e) => ` ! ${e}`).join('\n') + '\n'
    }
    comment += '-->\n\n'
  }
  return comment
}

/**
 * Split a chat body into the conversation markdown and the parsed TURN log.
 *
 * The log is recognized only as an unbroken run of TURN comments at the end
 * of the document, so conversation text that merely quotes the format stays
 * in the body. The eight filler newlines the serializer adds are collapsed
 * back to the body's own single trailing newline, keeping the round-trip law
 * exact for writer-produced files.
 */
export function splitContextLog(markdown: string): { body: string; entries: ContextTurnLog[] } {
  const start = logStartIndex(markdown)
  if (start === -1) return { body: markdown, entries: [] }

  const entries: ContextTurnLog[] = []
  for (const match of markdown.slice(start).matchAll(ENTRY_PATTERN)) {
    entries.push(parseEntry(Number(match[1]), match[2]))
  }

  const body = markdown.slice(0, start).replace(/\n+$/, '\n')
  return { body, entries }
}

// (?:(?!-->)[\s\S])* — comment content that can never cross a `-->`. A lazy
// [\s\S]*? is not enough: under backtracking it grows past the terminator,
// letting a quoted TURN comment mid-body swallow real text and still match.
const LOG_BLOCK_PATTERN = /^(?:<!-- TURN \d+\n(?:(?!-->)[\s\S])*-->\n*)+$/
const ENTRY_PATTERN = /<!-- TURN (\d+)\n((?:(?!-->)[\s\S])*)-->/g

/** Earliest line-start `<!-- TURN` from which everything to EOF is pure log. */
function logStartIndex(markdown: string): number {
  let from = 0
  let idx: number
  while ((idx = markdown.indexOf('<!-- TURN ', from)) !== -1) {
    const atLineStart = idx === 0 || markdown[idx - 1] === '\n'
    if (atLineStart && LOG_BLOCK_PATTERN.test(markdown.slice(idx))) return idx
    from = idx + 1
  }
  return -1
}

type SectionKey = 'queries' | 'context' | 'diff' | 'pruned' | 'excluded' | 'errors'

const SECTION_HEADERS: Record<string, SectionKey> = {
  'QUERIES:': 'queries',
  'CONTEXT:': 'context',
  'DIFF:': 'diff',
  'PRUNED:': 'pruned',
  'EXCLUDED:': 'excluded',
  'ERRORS:': 'errors',
}

const ITEM_MARKERS: Record<SectionKey, string> = {
  queries: ' - ',
  context: ' - ',
  diff: ' + ',
  pruned: ' - ',
  excluded: ' - ',
  errors: ' ! ',
}

function parseEntry(turn: number, inner: string): ContextTurnLog {
  const entry: ContextTurnLog = { turn, queries: [], pruned: [] }
  let section: SectionKey | null = null
  let items: string[] | null = null

  const lines = inner.split('\n')
  if (lines.at(-1) === '') lines.pop()

  for (const line of lines) {
    const header = SECTION_HEADERS[line]
    if (header) {
      section = header
      items = []
      entry[header] = items
      continue
    }
    if (section && items && line.startsWith(ITEM_MARKERS[section])) {
      items.push(line.slice(ITEM_MARKERS[section].length))
      continue
    }
    // A marker with its trailing space stripped (' -' alone on the line):
    // old chats recorded queries that begin with a newline, and the
    // notebook's whitespace normalizer trims line-trailing spaces, so the
    // item's content starts on the continuation lines below.
    if (section && items && line === ITEM_MARKERS[section].trimEnd()) {
      items.push('')
      continue
    }
    // Continuation of a multi-line item (queries and error messages can span
    // lines). A stray line with no open item — the blank the serializer emits
    // for an empty CONTEXT section — has nothing to attach to and is dropped.
    if (items && items.length > 0) {
      items[items.length - 1] += '\n' + line
    }
  }
  return entry
}
