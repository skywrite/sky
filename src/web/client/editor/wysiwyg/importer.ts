/**
 * HTML → Markdown for pasted content (architecture §13.2, CLP-12, CLP-13): the block structure of
 * the pasted document as markdown blocks, inline formatting rewritten to markers — including the
 * span soup of Word and Google Docs, where bold and italic live in inline styles.
 */

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'dialog',
  'div',
  'dl',
  'fieldset',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'ul',
  'body',
  'html',
])

/** Does pasted text read as markdown source — several lines that start like blocks (CLP-13)? */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  const marked = lines.filter((line) => /^\s*(?:#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s|```|~~~|\|.*\|)/.test(line)).length
  return lines.length >= 2 && marked >= 2 && marked * 2 >= lines.length
}

export function htmlToMarkdown(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const element of parsed.querySelectorAll('script, style, head, meta, link, title')) element.remove()
  const blocks = blocksOf(parsed.body, 0)
  return blocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Wraps a leaf's content by whatever markers apply to an element (bold, italic, code, …). */
function inlineOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ')
  if (!(node instanceof HTMLElement)) return ''
  const tag = node.tagName.toLowerCase()
  if (tag === 'br') return '\n'
  if (tag === 'img') {
    const alt = node.getAttribute('alt') ?? ''
    const src = node.getAttribute('src') ?? ''
    return src ? `![${alt}](${src})` : ''
  }
  if (tag === 'input') return ''
  const inner = [...node.childNodes].map(inlineOf).join('')
  if (inner.trim().length === 0 && tag !== 'a') return inner
  const style = node.getAttribute('style') ?? ''
  const weight = /font-weight\s*:\s*(bold|[6-9]00)/i.test(style)
  const normalWeight = /font-weight\s*:\s*(normal|[1-5]00)/i.test(style)
  const italic = /font-style\s*:\s*italic/i.test(style)
  const struck = /text-decoration[^;]*line-through/i.test(style)
  const underlined = /text-decoration[^;]*underline/i.test(style)
  const pad = (open: string, close: string) => {
    const lead = /^\s*/.exec(inner)?.[0] ?? ''
    const trail = /\s*$/.exec(inner)?.[0] ?? ''
    const core = inner.slice(lead.length, inner.length - trail.length)
    return core.length > 0 ? `${lead}${open}${core}${close}${trail}` : inner
  }
  switch (tag) {
    case 'a': {
      const href = node.getAttribute('href') ?? ''
      const text = inner.trim().length > 0 ? inner : href
      return href ? `[${text}](${href})` : text
    }
    case 'strong':
    case 'b':
      return normalWeight ? inner : pad('**', '**')
    case 'em':
    case 'i':
      return pad('*', '*')
    case 'code':
    case 'kbd':
    case 'samp':
      return pad('`', '`')
    case 's':
    case 'strike':
    case 'del':
      return pad('~~', '~~')
    case 'u':
      return pad('<u>', '</u>')
    case 'mark':
      return pad('==', '==')
  }
  let out = inner
  if (weight) out = pad('**', '**')
  if (italic) out = `*${out}*`
  if (struck) out = `~~${out}~~`
  if (underlined && tag === 'span') out = `<u>${out}</u>`
  return out
}

function isBlock(node: Node): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    (BLOCK_TAGS.has(node.tagName.toLowerCase()) || /display\s*:\s*block/i.test(node.getAttribute('style') ?? ''))
  )
}

/** The markdown blocks of an element's children: runs of inline nodes become paragraphs. */
function blocksOf(container: Node, depth: number): string[] {
  const blocks: string[] = []
  let run: Node[] = []
  const flush = () => {
    if (run.length === 0) return
    const text = run
      .map(inlineOf)
      .join('')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .trim()
    if (text.length > 0) blocks.push(text)
    run = []
  }
  for (const child of container.childNodes) {
    if (isBlock(child)) {
      flush()
      blocks.push(...blockOf(child, depth))
    } else if (child.nodeType === Node.TEXT_NODE || child instanceof HTMLElement) {
      if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim().length === 0 && run.length === 0)
        continue
      run.push(child)
    }
  }
  flush()
  return blocks
}

function blockOf(element: HTMLElement, depth: number): string[] {
  const tag = element.tagName.toLowerCase()
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = [...element.childNodes].map(inlineOf).join('').replace(/\s+/g, ' ').trim()
      return text ? [`${'#'.repeat(Number(tag[1]))} ${text}`] : []
    }
    case 'p':
      return blocksOf(element, depth)
    case 'hr':
      return ['---']
    case 'blockquote':
      return [
        blocksOf(element, depth)
          .join('\n\n')
          .split('\n')
          .map((line) => (line.length ? `> ${line}` : '>'))
          .join('\n'),
      ]
    case 'pre': {
      const code = element.querySelector('code')
      const lang = /(?:language|lang)-([\w+-]+)/.exec(`${element.className} ${code?.className ?? ''}`)?.[1] ?? ''
      const text = (element.textContent ?? '').replace(/\n$/, '')
      const fence = text.includes('```') ? '````' : '```'
      return [`${fence}${lang}\n${text}\n${fence}`]
    }
    case 'ul':
    case 'ol':
      return [listOf(element, depth)]
    case 'table':
      return [tableOf(element)]
    case 'li':
      return blocksOf(element, depth)
    default:
      return blocksOf(element, depth)
  }
}

function listOf(list: HTMLElement, depth: number): string {
  const ordered = list.tagName.toLowerCase() === 'ol'
  const lines: string[] = []
  let number = Number(list.getAttribute('start') ?? '1') || 1
  for (const item of list.children) {
    if (item.tagName.toLowerCase() !== 'li') continue
    const marker = ordered ? `${number++}.` : '-'
    const indent = ' '.repeat(marker.length + 1)
    const checkbox = item.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]')
    const task = checkbox ? ((checkbox as HTMLInputElement).checked ? '[x] ' : '[ ] ') : ''
    const own: Node[] = []
    const nested: string[] = []
    for (const child of item.childNodes) {
      if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL'))
        nested.push(listOf(child, depth + 1))
      else own.push(child)
    }
    const holder = document.createElement('div')
    for (const node of own) holder.appendChild(node.cloneNode(true))
    const blocks = blocksOf(holder, depth + 1)
    const first = blocks.shift() ?? ''
    const body = [
      first,
      ...blocks.map((block) =>
        block
          .split('\n')
          .map((line) => (line.length ? indent + line : line))
          .join('\n'),
      ),
    ]
    lines.push(`${marker} ${task}${body.join('\n\n')}`)
    for (const sub of nested)
      lines.push(
        sub
          .split('\n')
          .map((line) => (line.length ? indent + line : line))
          .join('\n'),
      )
  }
  return lines.join('\n')
}

function tableOf(table: HTMLElement): string {
  const rows = [...table.querySelectorAll('tr')].map((row) =>
    [...row.children].filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH'),
  )
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const text = (cell: Element) =>
    [...cell.childNodes]
      .map(inlineOf)
      .join('')
      .replace(/\s*\n\s*/g, '<br>')
      .replace(/\|/g, '\\|')
      .trim()
  const align = rows[0]!.map((cell) => {
    const value = (
      cell.getAttribute('align') ??
      /text-align\s*:\s*(\w+)/i.exec(cell.getAttribute('style') ?? '')?.[1] ??
      ''
    ).toLowerCase()
    return value === 'left' ? ':--' : value === 'right' ? '--:' : value === 'center' ? ':-:' : '---'
  })
  while (align.length < width) align.push('---')
  const line = (cells: string[]) =>
    `| ${[...cells, ...Array.from({ length: width - cells.length }, () => '')].join(' | ')} |`
  const out = [line(rows[0]!.map(text)), line(align)]
  for (const row of rows.slice(1)) out.push(line(row.map(text)))
  return out.join('\n')
}
