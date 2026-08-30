/**
 * The inline lexer (architecture §4.3): a block's text → a tree of inline nodes. Every character of
 * the source lands in exactly one node, in order, so that a renderer which keeps syntax characters
 * in the DOM reproduces the text exactly. Emphasis, strike and highlight use the CommonMark
 * delimiter-run algorithm; links and images use its bracket procedure.
 */

export type EmphasisKind = 'em' | 'strong' | 'strike' | 'highlight'

export type LinkForm = 'inline' | 'full' | 'collapsed' | 'shortcut'

export type InlineNode =
  | { type: 'text'; text: string }
  /** A backslash escape: the two source characters. */
  | { type: 'escape'; text: string }
  /** open/close backtick runs, the stripped padding space on each side, and the literal inside. */
  | { type: 'code'; open: string; pre: string; inner: string; post: string; close: string }
  | { type: 'emphasis'; kind: EmphasisKind; delim: string; children: InlineNode[] }
  | {
      type: 'link'
      form: LinkForm
      children: InlineNode[]
      /** Everything between `(` and `)` as written (inline form). */
      destRaw: string
      /** The reference label as written (reference forms). */
      label: string
      href: string
      title: string | null
    }
  | {
      type: 'image'
      form: LinkForm
      /** The whole source, `![alt](src "title")`. */
      text: string
      alt: string
      destRaw: string
      label: string
      src: string
      title: string | null
    }
  | { type: 'autolink'; text: string; href: string; bracketed: boolean }
  | { type: 'html'; text: string }
  | { type: 'underline'; open: string; close: string; children: InlineNode[] }
  /** Two or more spaces, or a backslash, then the newline. */
  | { type: 'hardbreak'; text: string }
  | { type: 'softbreak' }

export interface Definition {
  href: string
  title: string | null
}

export interface LexContext {
  /** Resolves a reference label to its definition, or null. Reference links render either way. */
  findDefinition?: (label: string) => Definition | null
}

// --- items: a doubly linked list of nodes under construction ------------------------------------

interface Item {
  node: InlineNode
  prev: Item | null
  next: Item | null
}

interface Delimiter {
  item: Item
  char: string
  count: number
  origCount: number
  canOpen: boolean
  canClose: boolean
  prev: Delimiter | null
  next: Delimiter | null
}

interface UnderlineMarker {
  item: Item
  prev: UnderlineMarker | null
}

interface Bracket {
  item: Item
  image: boolean
  active: boolean
  /** The delimiter on top of the stack when the bracket was pushed. */
  delimBottom: Delimiter | null
  prev: Bracket | null
}

const ASCII_PUNCT = /[!-/:-@[-`{-~]/
const PUNCT_RE = /[\p{P}\p{S}]/u
const WHITESPACE_RE = /[\s]/u
const AUTOLINK_RE = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/
const EMAIL_AUTOLINK_RE =
  /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/
const HTML_TAG_RE =
  /^(?:<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Z]+\s+[^>]*>|<!\[CDATA\[[\s\S]*?\]\]>)/
const URL_START_RE = /^(?:https?:\/\/|www\.)/i
const LINK_LABEL_RE = /^\[((?:[^\[\]\\]|\\.){0,999})\]/

function isWhitespace(ch: string | undefined): boolean {
  return ch === undefined || WHITESPACE_RE.test(ch)
}

function isPunctuation(ch: string | undefined): boolean {
  return ch !== undefined && PUNCT_RE.test(ch)
}

export function lexInline(text: string, context: LexContext = {}): InlineNode[] {
  return new InlineLexer(text, context).run()
}

class InlineLexer {
  private pos = 0
  private readonly head: Item = { node: { type: 'text', text: '' }, prev: null, next: null }
  private tail: Item = this.head
  private delimTop: Delimiter | null = null
  private bracketTop: Bracket | null = null
  private underlineTop: UnderlineMarker | null = null

  constructor(
    private readonly text: string,
    private readonly context: LexContext,
  ) {}

  run(): InlineNode[] {
    const text = this.text
    let textStart = 0
    const flushText = (end: number) => {
      if (end > textStart) this.append({ type: 'text', text: text.slice(textStart, end) })
    }
    while (this.pos < text.length) {
      const ch = text[this.pos]!
      const consumed = this.scanSpecial(ch, () => flushText(this.pos))
      if (consumed) {
        textStart = this.pos
        continue
      }
      this.pos++
    }
    flushText(text.length)
    this.processEmphasis(null)
    return collect(this.head.next)
  }

  /** Tries every construct at the current position; returns true when one consumed input. */
  private scanSpecial(ch: string, flush: () => void): boolean {
    const text = this.text
    const pos = this.pos
    switch (ch) {
      case '\\': {
        const next = text[pos + 1]
        if (next === '\n') {
          flush()
          this.append({ type: 'hardbreak', text: '\\\n' })
          this.pos += 2
          return true
        }
        if (next !== undefined && ASCII_PUNCT.test(next)) {
          flush()
          this.append({ type: 'escape', text: `\\${next}` })
          this.pos += 2
          return true
        }
        return false
      }
      case '`': {
        let run = 1
        while (text[pos + run] === '`') run++
        const opener = '`'.repeat(run)
        let search = pos + run
        while (search < text.length) {
          const close = text.indexOf(opener, search)
          if (close === -1) break
          let closeRun = run
          while (text[close + closeRun] === '`') closeRun++
          if (closeRun === run) {
            flush()
            let inner = text.slice(pos + run, close)
            let pre = ''
            let post = ''
            if (inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim().length > 0) {
              pre = ' '
              post = ' '
              inner = inner.slice(1, -1)
            }
            this.append({ type: 'code', open: opener, pre, inner, post, close: opener })
            this.pos = close + run
            return true
          }
          search = close + closeRun
        }
        flush()
        this.append({ type: 'text', text: opener })
        this.pos += run
        return true
      }
      case '*':
      case '_':
      case '~':
      case '=': {
        let run = 1
        while (text[pos + run] === ch) run++
        if ((ch === '~' && run > 2) || (ch === '=' && run !== 2)) {
          flush()
          this.append({ type: 'text', text: ch.repeat(run) })
          this.pos += run
          return true
        }
        flush()
        const prev = text[pos - 1]
        const next = text[pos + run]
        const leftFlanking = !isWhitespace(next) && (!isPunctuation(next) || isWhitespace(prev) || isPunctuation(prev))
        const rightFlanking = !isWhitespace(prev) && (!isPunctuation(prev) || isWhitespace(next) || isPunctuation(next))
        let canOpen = leftFlanking
        let canClose = rightFlanking
        if (ch === '_') {
          canOpen = leftFlanking && (!rightFlanking || isPunctuation(prev))
          canClose = rightFlanking && (!leftFlanking || isPunctuation(next))
        }
        const item = this.append({ type: 'text', text: ch.repeat(run) })
        this.pushDelimiter({ item, char: ch, count: run, origCount: run, canOpen, canClose, prev: null, next: null })
        this.pos += run
        return true
      }
      case '!': {
        if (text[pos + 1] !== '[') return false
        flush()
        const item = this.append({ type: 'text', text: '![' })
        this.pushBracket(item, true)
        this.pos += 2
        return true
      }
      case '[': {
        flush()
        const item = this.append({ type: 'text', text: '[' })
        this.pushBracket(item, false)
        this.pos += 1
        return true
      }
      case ']': {
        flush()
        this.closeBracket()
        return true
      }
      case '<': {
        const rest = text.slice(pos)
        const auto = AUTOLINK_RE.exec(rest)
        if (auto) {
          flush()
          this.append({ type: 'autolink', text: auto[1]!, href: auto[1]!, bracketed: true })
          this.pos += auto[0].length
          return true
        }
        const email = EMAIL_AUTOLINK_RE.exec(rest)
        if (email) {
          flush()
          this.append({ type: 'autolink', text: email[1]!, href: `mailto:${email[1]}`, bracketed: true })
          this.pos += email[0].length
          return true
        }
        const tag = HTML_TAG_RE.exec(rest)
        if (tag) {
          flush()
          const raw = tag[0]
          const lower = raw.toLowerCase()
          if (lower === '<u>') {
            const item = this.append({ type: 'html', text: raw })
            this.underlineTop = { item, prev: this.underlineTop }
          } else if (lower === '</u>' && this.underlineTop) {
            const opener = this.underlineTop
            this.underlineTop = opener.prev
            this.wrapUnderline(opener.item, raw)
          } else {
            this.append({ type: 'html', text: raw })
          }
          this.pos += raw.length
          return true
        }
        return false
      }
      case '\n': {
        flush()
        this.append({ type: 'softbreak' })
        this.pos += 1
        return true
      }
      case ' ': {
        let run = 1
        while (text[pos + run] === ' ') run++
        if (run >= 2 && text[pos + run] === '\n') {
          flush()
          this.append({ type: 'hardbreak', text: `${' '.repeat(run)}\n` })
          this.pos += run + 1
          return true
        }
        return false
      }
      case 'h':
      case 'H':
      case 'w':
      case 'W': {
        const prev = text[pos - 1]
        if (!(prev === undefined || isWhitespace(prev) || '*_~('.includes(prev))) return false
        if (!URL_START_RE.test(text.slice(pos, pos + 8))) return false
        const url = scanBareUrl(text.slice(pos))
        if (!url) return false
        flush()
        const href = url.toLowerCase().startsWith('www.') ? `http://${url}` : url
        this.append({ type: 'autolink', text: url, href, bracketed: false })
        this.pos += url.length
        return true
      }
      default:
        return false
    }
  }

  private append(node: InlineNode): Item {
    const item: Item = { node, prev: this.tail, next: null }
    this.tail.next = item
    this.tail = item
    return item
  }

  private removeItem(item: Item) {
    if (item.prev) item.prev.next = item.next
    if (item.next) item.next.prev = item.prev
    else this.tail = item.prev ?? this.head
  }

  /** Unlinks every item strictly between `from` and `to` and returns their nodes. */
  private extractBetween(from: Item, to: Item | null): InlineNode[] {
    const nodes: InlineNode[] = []
    let item = from.next
    while (item && item !== to) {
      nodes.push(item.node)
      item = item.next
    }
    from.next = to
    if (to) to.prev = from
    else this.tail = from
    return mergeText(nodes)
  }

  // --- delimiters ------------------------------------------------------------------------------

  private pushDelimiter(delimiter: Delimiter) {
    delimiter.prev = this.delimTop
    if (this.delimTop) this.delimTop.next = delimiter
    this.delimTop = delimiter
  }

  private removeDelimiter(delimiter: Delimiter) {
    if (delimiter.prev) delimiter.prev.next = delimiter.next
    if (delimiter.next) delimiter.next.prev = delimiter.prev
    else this.delimTop = delimiter.prev
  }

  /** CommonMark's "process emphasis", over the delimiters above `bottom`. */
  private processEmphasis(bottom: Delimiter | null) {
    const openersBottom = new Map<string, Delimiter | null>()
    let closer = bottom ? bottom.next : this.firstDelimiter()
    while (closer) {
      if (!closer.canClose) {
        closer = closer.next
        continue
      }
      const key = `${closer.char}${closer.canOpen ? 1 : 0}${closer.origCount % 3}`
      const floor = openersBottom.get(key)
      let opener = closer.prev
      let found = false
      while (opener && opener !== bottom && opener !== floor) {
        if (opener.char === closer.char && opener.canOpen && this.canPair(opener, closer)) {
          found = true
          break
        }
        opener = opener.prev
      }
      if (!found || !opener) {
        openersBottom.set(key, closer.prev)
        const next = closer.next
        if (!closer.canOpen) this.removeDelimiter(closer)
        closer = next
        continue
      }
      const use =
        closer.char === '*' || closer.char === '_' ? (closer.count >= 2 && opener.count >= 2 ? 2 : 1) : closer.count
      const delim = closer.char.repeat(use)
      const kind: EmphasisKind =
        closer.char === '~' ? 'strike' : closer.char === '=' ? 'highlight' : use === 2 ? 'strong' : 'em'
      opener.count -= use
      closer.count -= use
      const openerText = opener.item.node as { type: 'text'; text: string }
      const closerText = closer.item.node as { type: 'text'; text: string }
      openerText.text = openerText.text.slice(0, openerText.text.length - use)
      closerText.text = closerText.text.slice(use)
      const children = this.extractBetween(opener.item, closer.item)
      const emphasis: Item = { node: { type: 'emphasis', kind, delim, children }, prev: opener.item, next: closer.item }
      opener.item.next = emphasis
      closer.item.prev = emphasis
      // Delimiters between the two are gone with their items.
      let between = opener.next
      while (between && between !== closer) {
        const next = between.next
        this.removeDelimiter(between)
        between = next
      }
      if (opener.count === 0) {
        this.removeItem(opener.item)
        this.removeDelimiter(opener)
      }
      if (closer.count === 0) {
        this.removeItem(closer.item)
        const next = closer.next
        this.removeDelimiter(closer)
        closer = next
      }
    }
    // Drop everything above the bottom: these delimiters stay literal text.
    while (this.delimTop && this.delimTop !== bottom) this.removeDelimiter(this.delimTop)
  }

  private canPair(opener: Delimiter, closer: Delimiter): boolean {
    if (closer.char === '~' || closer.char === '=') return opener.count === closer.count
    const oddMatch =
      (closer.canOpen || opener.canClose) &&
      closer.origCount % 3 !== 0 &&
      (opener.origCount + closer.origCount) % 3 === 0
    return !oddMatch
  }

  private firstDelimiter(): Delimiter | null {
    let delimiter = this.delimTop
    while (delimiter?.prev) delimiter = delimiter.prev
    return delimiter
  }

  // --- brackets: links and images --------------------------------------------------------------

  private pushBracket(item: Item, image: boolean) {
    this.bracketTop = { item, image, active: true, delimBottom: this.delimTop, prev: this.bracketTop }
  }

  private closeBracket() {
    const text = this.text
    const opener = this.bracketTop
    if (!opener) {
      this.append({ type: 'text', text: ']' })
      this.pos += 1
      return
    }
    this.bracketTop = opener.prev
    if (!opener.active) {
      this.append({ type: 'text', text: ']' })
      this.pos += 1
      return
    }
    const after = this.pos + 1
    const openerStart = opener.image ? 2 : 1
    let form: LinkForm | null = null
    let destRaw = ''
    let label = ''
    let href = ''
    let title: string | null = null
    let end = after
    const labelText = this.sourceBetween(opener.item, openerStart)

    if (text[after] === '(') {
      const inline = parseInlineDestination(text, after + 1)
      if (inline) {
        form = 'inline'
        destRaw = inline.raw
        href = inline.href
        title = inline.title
        end = inline.end
      }
    }
    if (!form) {
      const ref = LINK_LABEL_RE.exec(text.slice(after))
      if (ref && ref[1]!.length > 0) {
        form = 'full'
        label = ref[1]!
        end = after + ref[0].length
      } else if (ref && this.context.findDefinition?.(labelText)) {
        form = 'collapsed'
        label = labelText
        end = after + ref[0].length
      } else if (labelText.length > 0 && this.context.findDefinition?.(labelText)) {
        form = 'shortcut'
        label = labelText
      }
    }
    if (!form) {
      this.append({ type: 'text', text: ']' })
      this.pos += 1
      return
    }
    if (form !== 'inline') {
      const definition = this.context.findDefinition?.(label) ?? null
      href = definition?.href ?? ''
      title = definition?.title ?? null
    }

    this.processEmphasis(opener.delimBottom)
    const children = this.extractBetween(opener.item, null)
    const raw = text.slice(this.offsetOf(opener.item), end)
    if (opener.image) {
      opener.item.node = { type: 'image', form, text: raw, alt: plainText(children), destRaw, label, src: href, title }
    } else {
      opener.item.node = { type: 'link', form, children, destRaw, label, href, title }
      for (let bracket = this.bracketTop; bracket; bracket = bracket.prev) {
        if (!bracket.image) bracket.active = false
      }
    }
    this.pos = end
  }

  /** The source text between a bracket opener and the current `]`. */
  private sourceBetween(opener: Item, openerLength: number): string {
    return this.text.slice(this.offsetOf(opener) + openerLength, this.pos)
  }

  /** Where an item's source starts: the source lengths of everything before it. */
  private offsetOf(target: Item): number {
    let offset = 0
    for (let item = this.head.next; item && item !== target; item = item.next) offset += sourceLength(item.node)
    return offset
  }

  /** Turns the `<u>` item and everything after it into an underline; the caller consumes `</u>`. */
  private wrapUnderline(opener: Item, close: string) {
    const open = (opener.node as { type: 'html'; text: string }).text
    const children = this.extractBetween(opener, null)
    opener.node = { type: 'underline', open, close, children }
  }
}

// --- helpers -----------------------------------------------------------------------------------

function mergeText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    const last = out[out.length - 1]
    if (node.type === 'text' && node.text.length === 0) continue
    if (node.type === 'text' && last?.type === 'text') last.text += node.text
    else out.push(node)
  }
  return out
}

function collect(first: Item | null): InlineNode[] {
  const nodes: InlineNode[] = []
  for (let item = first; item; item = item.next) nodes.push(item.node)
  return mergeText(nodes)
}

/** The source text a node stands for — the inverse of lexing. */
export function sourceOf(node: InlineNode): string {
  switch (node.type) {
    case 'text':
    case 'escape':
    case 'html':
    case 'hardbreak':
      return node.text
    case 'softbreak':
      return '\n'
    case 'code':
      return node.open + node.pre + node.inner + node.post + node.close
    case 'emphasis':
      return node.delim + sourceOfAll(node.children) + node.delim
    case 'link':
      return `[${sourceOfAll(node.children)}]${linkSuffix(node)}`
    case 'image':
      return node.text
    case 'autolink':
      return node.bracketed ? `<${node.text}>` : node.text
    case 'underline':
      return node.open + sourceOfAll(node.children) + node.close
  }
}

export function sourceOfAll(nodes: InlineNode[]): string {
  let out = ''
  for (const node of nodes) out += sourceOf(node)
  return out
}

/** The characters after a link's `]`, as written. */
export function linkSuffix(node: { form: LinkForm; destRaw: string; label: string }): string {
  switch (node.form) {
    case 'inline':
      return `(${node.destRaw})`
    case 'full':
      return `[${node.label}]`
    case 'collapsed':
      return '[]'
    case 'shortcut':
      return ''
  }
}

function sourceLength(node: InlineNode): number {
  return sourceOf(node).length
}

/** The rendered text of nodes with formatting dropped (image alt text). */
export function plainText(nodes: InlineNode[]): string {
  let out = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'html':
        out += node.text
        break
      case 'escape':
        out += node.text.slice(1)
        break
      case 'code':
        out += node.inner
        break
      case 'emphasis':
      case 'link':
      case 'underline':
        out += plainText(node.children)
        break
      case 'image':
        out += node.alt
        break
      case 'autolink':
        out += node.text
        break
      case 'hardbreak':
      case 'softbreak':
        out += '\n'
        break
    }
  }
  return out
}

interface InlineDestination {
  raw: string
  href: string
  title: string | null
  /** Offset just past the closing `)`. */
  end: number
}

/** Parses `dest "title")` starting after the `(`; null when it is not a link. */
function parseInlineDestination(text: string, start: number): InlineDestination | null {
  let i = start
  while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n')) i++
  let destination = ''
  if (text[i] === '<') {
    const close = text.indexOf('>', i + 1)
    if (close === -1) return null
    destination = text.slice(i + 1, close)
    if (destination.includes('\n')) return null
    i = close + 1
  } else {
    let depth = 0
    const destStart = i
    while (i < text.length) {
      const ch = text[i]!
      if (ch === '\\' && i + 1 < text.length) {
        i += 2
        continue
      }
      if (ch === '(') depth++
      else if (ch === ')') {
        if (depth === 0) break
        depth--
      } else if (isWhitespace(ch)) break
      i++
    }
    destination = text.slice(destStart, i)
  }
  const afterDest = i
  while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n')) i++
  let title: string | null = null
  const quote = text[i]
  if (i > afterDest && (quote === '"' || quote === "'" || quote === '(')) {
    const closeQuote = quote === '(' ? ')' : quote
    let j = i + 1
    while (j < text.length && text[j] !== closeQuote) {
      if (text[j] === '\\') j++
      j++
    }
    if (j >= text.length) return null
    title = unescapeText(text.slice(i + 1, j))
    i = j + 1
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n')) i++
  }
  if (text[i] !== ')') return null
  return { raw: text.slice(start, i), href: unescapeText(destination), title, end: i + 1 }
}

function unescapeText(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1')
}

/** A GFM autolink literal at the start of `rest`: the URL with trailing punctuation trimmed. */
function scanBareUrl(rest: string): string | null {
  let end = 0
  while (end < rest.length && !isWhitespace(rest[end]) && rest[end] !== '<') end++
  let url = rest.slice(0, end)
  while (url.length > 0 && '?!.,:*_~\'"'.includes(url[url.length - 1]!)) url = url.slice(0, -1)
  while (url.endsWith(')')) {
    const opens = (url.match(/\(/g) ?? []).length
    const closes = (url.match(/\)/g) ?? []).length
    if (closes <= opens) break
    url = url.slice(0, -1)
  }
  if (/^www\./i.test(url) && !/^www\.[^.\s]+\.[^\s]+/i.test(url)) return null
  if (/^https?:\/\//i.test(url) && url.length <= 8) return null
  return url.length > 0 ? url : null
}
