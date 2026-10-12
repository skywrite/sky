import { Lexer, type Token, type Tokens } from 'marked'

export type LinkSite = 'slack' | 'doc' | 'sheet' | 'slides' | 'web'

/** A web address as a list row shows it: a short name for where it goes, in place of the address. */
export interface WebLink {
  href: string
  label: string
  site: LinkSite
}

/** A run of the item's words, or a web address lifted out of them. */
export type TextPart = string | WebLink

export function isWebHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/** A notebook or workstream link carries the whole row; a web address becomes a chip beside the words. */
export function itemDocLinked(item: { link: { path: string } | null; workstream?: unknown }): boolean {
  return Boolean(item.link && (item.workstream || !isWebHref(item.link.path)))
}

// Sites named in words. Any other address is named by its host.
const SITES: [domain: string, name: string][] = [
  ['docs.google.com', 'Google Docs'],
  ['drive.google.com', 'Google Drive'],
  ['meet.google.com', 'Google Meet'],
  ['mail.google.com', 'Gmail'],
  ['calendar.google.com', 'Google Calendar'],
  ['github.com', 'GitHub'],
  ['zoom.us', 'Zoom'],
  ['notion.so', 'Notion'],
  ['figma.com', 'Figma'],
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['linkedin.com', 'LinkedIn'],
]

/** Name an address from the address alone; nothing is fetched. */
export function webLink(href: string): WebLink {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { href, label: href, site: 'web' }
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  if (on('slack.com'))
    return { href, site: 'slack', label: /^\/archives\/[^/]+\/p\d+/.test(path) ? 'Slack message' : 'Slack' }
  if (host === 'docs.google.com') {
    if (path.startsWith('/document')) return { href, site: 'doc', label: 'Google Doc' }
    if (path.startsWith('/spreadsheets')) return { href, site: 'sheet', label: 'Google Sheet' }
    if (path.startsWith('/presentation')) return { href, site: 'slides', label: 'Google Slides' }
  }
  if (host === 'github.com') {
    const numbered = /^\/[^/]+\/([^/]+)\/(?:pull|issues)\/(\d+)/.exec(path)
    if (numbered) return { href, site: 'web', label: `${numbered[1]} #${numbered[2]}` }
  }
  return { href, site: 'web', label: SITES.find(([domain]) => on(domain))?.[1] ?? host }
}

function linkTokens(tokens: Token[]): Tokens.Link[] {
  return tokens.flatMap((token) =>
    token.type === 'link'
      ? [token as Tokens.Link]
      : 'tokens' in token && Array.isArray(token.tokens)
        ? linkTokens(token.tokens)
        : [],
  )
}

/**
 * An item's text with each web address lifted out, in reading order. A dash
 * or bracket that only led up to the address goes with it, as does a titled
 * link's Markdown. Null when the text holds no web address, so a plain row
 * renders exactly as before.
 */
export function textParts(source: string): TextPart[] | null {
  const parts: TextPart[] = []
  const push = (words: string) => {
    if (words.trim()) parts.push(words.trim())
  }
  let words = ''
  let cursor = 0
  for (const token of linkTokens(Lexer.lexInline(source))) {
    const at = source.indexOf(token.raw, cursor)
    if (at < 0) continue
    const titled = token.raw.startsWith('[')
    words += source.slice(cursor, at)
    cursor = at + token.raw.length
    if (!isWebHref(token.href)) {
      words += titled ? token.text : token.raw
      continue
    }
    // `[https://…](https://…)` is an address wearing brackets, not a title worth keeping.
    if (titled && !/^(?:https?:\/\/|www\.)\S*$/i.test(token.text.trim())) words += token.text
    else {
      // `Task - https://…` and `Task (https://…)`: the punctuation only introduced the address.
      if (/\(\s*$/.test(words) && source[cursor] === ')') {
        words = words.replace(/\(\s*$/, '')
        cursor++
      }
      words = words.replace(/(?:(^|\s)[-–—|]|:)\s*$/, '$1')
    }
    push(words)
    parts.push(webLink(token.href))
    words = ''
  }
  if (!parts.some((part) => typeof part !== 'string')) return null
  words += source.slice(cursor)
  // An address that opened the item may be followed by the same kind of dash.
  if (parts.length === 1) words = words.replace(/^\s*[-–—|:]\s+/, '')
  if (!/^\s*[.,;:!?]*\s*$/.test(words)) push(words)
  return parts
}
