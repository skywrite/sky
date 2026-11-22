/**
 * The addresses a reply drew on, kept under it as a trailing list headed
 * "Sources:" — the way the transcript records them and the page folds them.
 * A reply can arrive with two such lists: the model names its own sources,
 * and the session appends the pages its searches read. Here they are one
 * list, the reply's own first, each address once.
 */

import { Lexer, type Tokens } from 'marked'

const TRAILING_LIST = /\n\nSources:\n((?:- \S+\n?)+)$/

function unique(urls: readonly string[]): string[] {
  return [...new Set(urls)]
}

/** The stored URL-list format also participates in conversation and branch identity hashes. */
function splitStoredSources(content: string): { body: string; sources: string[] } {
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

/** A citation's destination and the author's description beside it. */
export function sourceReference(entry: string): { target: string; label?: string; note: string } | undefined {
  const first = Lexer.lexInline(entry)[0]
  if (!first) return undefined
  if (first.type === 'link') {
    return {
      target: first.href,
      label: first.text === first.href ? undefined : first.text,
      note: entry.slice(first.raw.length),
    }
  }
  if (first.type === 'codespan') return { target: first.text, note: entry.slice(first.raw.length) }
  const file = /^([^\n]+?\.md)(?=\s|[.,;]?$)/i.exec(entry)
  return file ? { target: file[1]!, note: entry.slice(file[0].length) } : undefined
}

/** Fold the final top-level Sources sections while keeping source examples inside quotes and code in the reply. */
export function splitSources(content: string, found: readonly string[] = []): { body: string; sources: string[] } {
  if (!/^ {0,3}(?:#{1,6}[ \t]+)?(?:\*\*|__)?sources\b/im.test(content)) return { body: content, sources: unique(found) }
  const markdown = content.trimEnd().replace(/\r\n?/g, '\n')
  const blocks = Lexer.lex(markdown)
  const lists: string[][] = []
  let start = blocks.length
  let index = blocks.length - 1
  while (blocks[index]?.type === 'list') {
    const list = blocks[index] as Tokens.List
    index--
    if (blocks[index]?.type === 'space') index--
    const heading = blocks[index]
    if (heading?.type !== 'heading' && heading?.type !== 'paragraph') break
    if (!/^(?:sources:?|\*\*sources:?\*\*:?|__sources:?__:?)$/i.test(heading.text.trim())) break
    lists.unshift(list.items.map((item) => item.text.trimEnd()))
    start = index
    index--
    if (blocks[index]?.type === 'space') index--
  }
  if (!lists.length) return { body: content, sources: unique(found) }
  // The lexer can omit reference definitions. Only remove a suffix that accounts for the actual text.
  const suffix = blocks
    .slice(start)
    .map((block) => block.raw)
    .join('')
  if (!markdown.endsWith(suffix)) return { body: content, sources: unique(found) }
  const suffixLines = suffix.split('\n').length
  const body = content
    .trimEnd()
    .split(/(?<=\n)|(?<=\r)(?!\n)/)
    .slice(0, -suffixLines)
    .join('')
    .trimEnd()
  const entries = unique([...lists.flat(), ...found])
  // An annotated citation covers the provider's bare URL. Distinct notes about one source both belong in the fold.
  const described = new Set(
    entries.map((entry) => {
      const ref = sourceReference(entry)
      return ref && entry !== ref.target ? ref.target : undefined
    }),
  )
  return { body, sources: entries.filter((entry) => !described.has(entry)) }
}

/** The reply with one Sources list: the addresses it named, then the pages its searches read that it did not name. A reply with nothing to list is returned as it is. */
export function withSources(text: string, found: readonly string[]): string {
  const { body, sources } = splitStoredSources(text)
  const all = unique([...sources, ...found])
  if (all.length === 0) return text
  return `${body}\n\nSources:\n${all.map((url) => `- ${url}`).join('\n')}`
}
