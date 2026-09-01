/** `who:`/`rel:` lists the user typed literally in a freeform correction. */
export interface TypedNameLists {
  who?: string[]
  rel?: string[]
}

/**
 * Lift explicitly labelled `who:` / `rel:` name lists out of a freeform
 * correction string. The corrections prompt invites `rel: Sam Rivera,
 * Jordan` to match a bare name to a profile, and an explicit list needs a
 * regex, not a language model — read here, the names land in the field
 * verbatim and cannot be dropped, respelled, or reinterpreted, and a model
 * failure cannot discard them (the same rule extractTypedTime and
 * extractTypedParticipants apply to time: and from:/to:).
 *
 * A typed list replaces the whole field, as the prompt's hint says. Names
 * are comma-separated and taken as written; the list ends at a semicolon,
 * at the end of the line, or before the next `label:` segment, so
 * `rel: Sam Rivera, duration: 13 mins` keeps the chained-fields
 * convention working. A lone `none`/`nobody` clears the field. Only the
 * labelled form at a segment start is matched — freeform phrasing
 * ("make it clearer who: attended") falls through to the AI parse — and an
 * empty value (`rel:` with nothing after it) is ignored rather than read
 * as a clear.
 */
export function extractTypedNameLists(correction: string): TypedNameLists {
  const result: TypedNameLists = {}
  const who = extractList(correction, /(?:^|[,;\n])\s*who\s*:\s*/i)
  const rel = extractList(correction, /(?:^|[,;\n])\s*re(?:l|lated)\s*:\s*/i)
  if (who) result.who = who
  if (rel) result.rel = rel
  return result
}

/** A comma chunk that starts another labelled field, ending the list. */
const NEXT_LABEL = /^[A-Za-z]+\s*:/

const CLEAR_WORDS = new Set(['none', 'nobody'])

function extractList(correction: string, label: RegExp): string[] | undefined {
  const match = correction.match(label)
  if (match === null || match.index === undefined) return undefined
  const tail = correction.slice(match.index + match[0].length).split(/[;\n]/, 1)[0]
  const names: string[] = []
  for (const chunk of tail.split(',')) {
    const name = chunk.trim()
    if (NEXT_LABEL.test(name)) break
    if (name) names.push(name)
  }
  if (names.length === 1 && CLEAR_WORDS.has(names[0].toLowerCase())) return []
  return names.length > 0 ? names : undefined
}
