import { toolDisplayName } from '#universal/ai/toolDisplay.ts'

/**
 * What a tool said, read line by line for the page.
 *
 * A tool's lines are the terminal's words. One kind of line is a call the
 * tool made of its own — the research agent prints `→ notebook_query` with
 * the query under it, `→ notebook_read <path>` — and the page shows that as
 * a card: the call's name, and what it asked in full. Everything else is
 * what the tool said, shown as its words.
 */

/** A call the tool made: `→ name` and what it asked. */
export interface CallEntry {
  kind: 'call'
  /** The call as the tool names it (`notebook_query`) */
  tool: string
  /** What it asked — a query, a path, a name — or null when the line carried the name alone */
  detail: string | null
  /** The detail is a GraphQL query, shown as a colored block */
  graphql: boolean
  /** Whoever printed the record cut it short (an older narration kept a hundred characters) */
  cut: boolean
}

/** Anything else the tool printed. */
export interface SaidEntry {
  kind: 'said'
  text: string
}

export type ToolEntry = CallEntry | SaidEntry

/** `google_agent` → `google agent`. */
export function humanize(toolName: string): string {
  return toolName.replaceAll('_', ' ')
}

/** A line that begins with the arrow names a call; what it asked follows on the line or under it. */
const CALL = /^→[ \t]*(\S+)[ \t]*\r?\n?([\s\S]*)$/

/** A GraphQL document starts with a selection set — a brace and a name, where JSON has a brace and a quote — or an operation. */
export const GRAPHQL = /^(?:\{\s*[A-Za-z_]|(?:query|mutation|subscription|fragment)\b)/

export function parseToolLine(text: string): ToolEntry {
  const match = CALL.exec(text.trimStart())
  if (!match) return { kind: 'said', text: text.trim() }
  const [, tool, rest] = match
  const detail = dedent(rest).trim()
  if (detail === '') return { kind: 'call', tool, detail: null, graphql: false, cut: false }
  if (detail.startsWith('{"')) return fromJson(tool, detail)
  return { kind: 'call', tool, detail, graphql: GRAPHQL.test(detail), cut: false }
}

/** An older narration printed the call's input as JSON, cut to a terminal's width — read what is there. */
function fromJson(tool: string, json: string): CallEntry {
  const { fields, cut } = decodeJson(json)
  const graphql = fields.some((field) => field.key === 'graphql')
  const detail =
    fields.length === 1 ? fields[0].value : fields.map((field) => `${field.key}: ${field.value}`).join('\n')
  return { kind: 'call', tool, detail, graphql, cut }
}

interface Field {
  key: string
  value: string
}

function decodeJson(json: string): { fields: Field[]; cut: boolean } {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return partialJson(json)
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const fields = Object.entries(parsed).map(([key, value]) => ({ key, value: scalar(value) }))
    return { fields, cut: false }
  }
  return { fields: [{ key: '', value: json }], cut: false }
}

/** A record cut mid-way: its first field, as far as it goes. */
function partialJson(json: string): { fields: Field[]; cut: boolean } {
  const head = /^\{"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(json)
  if (!head) return { fields: [{ key: '', value: json }], cut: true }
  return { fields: [{ key: unescape(head[1]), value: unescape(head[2]) }], cut: true }
}

function scalar(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** The body of a JSON string, possibly cut inside an escape. */
function unescape(body: string): string {
  const whole = body.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, '')
  try {
    return JSON.parse(`"${whole}"`) as string
  } catch {
    return whole
  }
}

/** The common indent of the lines that have text, taken off every line. */
export function dedent(text: string): string {
  const lines = text.split('\n')
  const indentOf = (line: string) => line.length - line.trimStart().length
  const indents = lines.filter((line) => line.trim() !== '').map(indentOf)
  const common = indents.length > 0 ? Math.min(...indents) : 0
  if (common === 0) return text
  return lines.map((line) => line.slice(Math.min(common, indentOf(line)))).join('\n')
}

/** How long a line under a chip may run before it is cut; the whole record is a click away. */
const COMPACT_CHARS = 140

/** A tool's line as one line — the last thing it said under its chip, or a fold's label until the summary lands. */
export function compactLine(text: string): string {
  const entry = parseToolLine(text)
  const words =
    entry.kind === 'said'
      ? entry.text
      : entry.detail === null
        ? toolDisplayName(entry.tool)
        : `${toolDisplayName(entry.tool)} · ${entry.detail}`
  const flat = words.replace(/\s+/g, ' ').trim()
  return flat.length > COMPACT_CHARS ? `${flat.slice(0, COMPACT_CHARS - 1)}…` : flat
}

export type GraphQLTokenType = 'string' | 'number' | 'keyword' | 'arg' | 'name' | 'punct' | 'text'

export interface GraphQLToken {
  type: GraphQLTokenType
  text: string
}

const KEYWORDS = new Set(['query', 'mutation', 'subscription', 'fragment', 'on'])
const LITERALS = new Set(['true', 'false', 'null'])
/** Strings, numbers, names, punctuation, whitespace, anything else — every character lands in one token. */
const TOKEN = /"(?:[^"\\]|\\.)*"?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|\s+|./g

/**
 * A query's text in tokens, for coloring: joined back, the tokens are the
 * text exactly. A name followed by a colon is an argument or an object
 * field; any other name is a field.
 */
export function graphqlTokens(code: string): GraphQLToken[] {
  const tokens: GraphQLToken[] = []
  for (const match of code.matchAll(TOKEN)) {
    const text = match[0]
    tokens.push({ type: typeOf(text, code.slice((match.index ?? 0) + text.length)), text })
  }
  return tokens
}

function typeOf(text: string, after: string): GraphQLTokenType {
  if (text.startsWith('"')) return 'string'
  if (/^-?\d/.test(text)) return 'number'
  if (/^[A-Za-z_]/.test(text)) {
    if (KEYWORDS.has(text)) return 'keyword'
    if (LITERALS.has(text)) return 'number'
    return /^\s*:/.test(after) ? 'arg' : 'name'
  }
  if (/^[{}()[\]:,!=@$|&]$/.test(text)) return 'punct'
  return 'text'
}
