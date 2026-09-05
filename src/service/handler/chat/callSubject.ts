/**
 * What a tool call was about, in one line — the query it searched, the
 * page it fetched, the mission it ran. The page shows it after the tool's
 * name on the call's chip: "web search · atlas roadmap reviews".
 *
 * A tool with a field for what it acts on names it one of a few ways
 * (`query`, `url`, `path`, `mission`, `message`, `text`); failing those,
 * the call's first string field stands for it. Only the first line, its
 * spaces collapsed, cut to a chip's width; an address loses its scheme
 * and "www." so the width goes to the address itself. A call with no
 * string to show has no subject, and its chip keeps just the name.
 */

import truncate from '#shared/strings/truncate.ts'

const SUBJECT_KEYS = ['query', 'url', 'path', 'mission', 'message', 'text']
const SUBJECT_CHARS = 80

export function callSubject(input: unknown): string | undefined {
  const value = subjectField(input)
  if (value === undefined) return undefined
  const line = (value.split('\n').find((part) => part.trim()) ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, '')
  return line ? truncate(line, SUBJECT_CHARS, '…') : undefined
}

function subjectField(input: unknown): string | undefined {
  if (typeof input === 'string') return input
  if (!input || typeof input !== 'object') return undefined
  const fields = input as Record<string, unknown>
  const says = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
  const named = SUBJECT_KEYS.find((key) => says(fields[key]))
  if (named) return fields[named] as string
  return Object.values(fields).find(says)
}
