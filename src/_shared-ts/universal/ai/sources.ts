/**
 * The addresses a reply drew on, kept under it as a trailing list headed
 * "Sources:" — the way the transcript records them and the page folds them.
 * A reply can arrive with two such lists: the model names its own sources,
 * and the session appends the pages its searches read. Here they are one
 * list, the reply's own first, each address once.
 */

const TRAILING_LIST = /\n\nSources:\n((?:- \S+\n?)+)$/

function unique(urls: readonly string[]): string[] {
  return [...new Set(urls)]
}

/** The reply without its trailing Sources lists, and the addresses they held. A reply with no list is returned whole. */
export function splitSources(content: string): { body: string; sources: string[] } {
  let body = content
  const lists: string[][] = []
  for (let match = body.match(TRAILING_LIST); match; match = body.match(TRAILING_LIST)) {
    lists.unshift(
      match[1]
        .split('\n')
        .map((line) => line.replace(/^- /, '').trim())
        .filter(Boolean),
    )
    body = body.slice(0, match.index).trimEnd()
  }
  return { body, sources: unique(lists.flat()) }
}

/** The reply with one Sources list: the addresses it named, then the pages its searches read that it did not name. A reply with nothing to list is returned as it is. */
export function withSources(text: string, found: readonly string[]): string {
  const { body, sources } = splitSources(text)
  const all = unique([...sources, ...found])
  if (all.length === 0) return text
  return `${body}\n\nSources:\n${all.map((url) => `- ${url}`).join('\n')}`
}
