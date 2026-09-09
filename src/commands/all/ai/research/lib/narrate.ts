/**
 * A research call, told in the terminal's words.
 *
 * The agent's own tool calls are what a person watching it wants to see:
 * what it searched for, what it read. `→ notebook_query` with the query
 * under it, printed by graphql-js so a long argument list breaks where a
 * reader would break it; `→ notebook_read <path>` with the whole path. The
 * web page shows a line that begins with the arrow as a card — the name
 * and what it asked in full — so nothing here is cut to a terminal's width.
 */

import { parse, print } from 'graphql'
import truncate from '#shared/strings/truncate.ts'

/** A pathological input stays bounded; nothing a research tool takes comes close. */
const CALL_MAX_CHARS = 4000

/** `→ tool` and what it asked: a `graphql` field as a block under the name, any other field inline. */
export function describeCall(toolName: string, input: unknown): string {
  const head = `→ ${toolName}`
  if (input === null || input === undefined) return head
  if (typeof input !== 'object') return truncate(`${head} ${String(input)}`, CALL_MAX_CHARS, '…')

  const fields = Object.entries(input as Record<string, unknown>)
  const query = fields.find(([key, value]) => key === 'graphql' && typeof value === 'string')
  const rest = fields.filter((field) => field !== query)
  const inline =
    rest.length === 1 ? scalar(rest[0][1]) : rest.map(([key, value]) => `${key}: ${scalar(value)}`).join(', ')

  const lines = [inline ? `${head} ${inline}` : head]
  if (query)
    lines.push(
      ...prettyGraphQL(query[1] as string)
        .split('\n')
        .map((line) => `  ${line}`),
    )
  return truncate(lines.join('\n'), CALL_MAX_CHARS, '…')
}

function scalar(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** The query as graphql-js prints it; one that does not parse is shown as the model wrote it. */
function prettyGraphQL(query: string): string {
  try {
    return print(parse(query))
  } catch {
    return query.trim()
  }
}
