/**
 * Inline nodes → HTML, two ways (architecture §4.3). The editing decorator keeps every syntax
 * character in the DOM inside hidden spans, so the block's textContent is its markdown; the export
 * decorator emits clean semantic HTML with no syntax at all.
 */

import { escapeAttr, escapeHtml } from './html.ts'
import type { InlineNode } from './lexer.ts'

export type DecorateMode = 'editing' | 'export'

export interface DecorateContext {
  /** Turns an image source as written into the URL the browser loads. */
  resolveImage?: (src: string) => string
}

export function renderInline(nodes: InlineNode[], mode: DecorateMode, context: DecorateContext = {}): string {
  let out = ''
  for (const node of nodes) out += mode === 'editing' ? editing(node, context) : exported(node, context)
  return out
}

const syntax = (text: string, position = '') =>
  `<span class="syntax${position ? ` ${position}` : ''}">${escapeHtml(text)}</span>`
const content = (text: string, kind: string) => `<span class="content ${kind}">${escapeHtml(text)}</span>`

const EMPHASIS_TAG = { em: 'em', strong: 'strong', strike: 'del', highlight: 'mark' } as const

function editing(node: InlineNode, context: DecorateContext): string {
  switch (node.type) {
    case 'text':
      return `<span data-inline="plain">${escapeHtml(node.text)}</span>`
    case 'escape':
      return `<span data-inline="escape">${syntax('\\')}${escapeHtml(node.text.slice(1))}</span>`
    case 'code':
      return `<span data-inline="code" class="paired">${syntax(node.open + node.pre, 'before')}<code spellcheck="false">${escapeHtml(node.inner)}</code>${syntax(node.post + node.close, 'after')}</span>`
    case 'emphasis': {
      const tag = EMPHASIS_TAG[node.kind]
      return `<span data-inline="${node.kind}" class="paired">${syntax(node.delim, 'before')}<${tag}>${renderInline(node.children, 'editing', context)}</${tag}>${syntax(node.delim, 'after')}</span>`
    }
    case 'link': {
      const title = node.title === null ? '' : ` title="${escapeAttr(node.title)}"`
      const inner = `<a href="${escapeAttr(node.href)}"${title} spellcheck="false">${renderInline(node.children, 'editing', context)}</a>`
      let tail: string
      switch (node.form) {
        case 'inline':
          tail = `${syntax('](')}${content(node.destRaw, 'url')}${syntax(')', 'after')}`
          break
        case 'full':
          tail = `${syntax('][')}${content(node.label, 'ref')}${syntax(']', 'after')}`
          break
        case 'collapsed':
          tail = syntax('][]', 'after')
          break
        case 'shortcut':
          tail = syntax(']', 'after')
          break
      }
      return `<span data-inline="link" data-form="${node.form}">${syntax('[', 'before')}${inner}${tail}</span>`
    }
    case 'image': {
      const src = context.resolveImage ? context.resolveImage(node.src) : node.src
      const title = node.title === null ? '' : ` title="${escapeAttr(node.title)}"`
      return `<span data-inline="image" contenteditable="false"><span class="syntax content" contenteditable="true">${escapeHtml(node.text)}</span><img src="${escapeAttr(src)}" alt="${escapeAttr(node.alt)}"${title}></span>`
    }
    case 'autolink': {
      const anchor = `<a href="${escapeAttr(node.href)}" spellcheck="false">${escapeHtml(node.text)}</a>`
      return node.bracketed
        ? `<span data-inline="autolink">${syntax('<', 'before')}${anchor}${syntax('>', 'after')}</span>`
        : `<span data-inline="autolink">${anchor}</span>`
    }
    case 'html': {
      const lower = node.text.toLowerCase()
      if (lower === '<br>' || lower === '<br/>' || lower === '<br />') {
        return `<span data-inline="html" class="br">${syntax(node.text)}<br></span>`
      }
      const image = imgTag(node.text)
      if (image) {
        const src = context.resolveImage ? context.resolveImage(image.src) : image.src
        const size =
          (image.width ? ` width="${escapeAttr(image.width)}"` : '') +
          (image.height ? ` height="${escapeAttr(image.height)}"` : '')
        return `<span data-inline="html" class="img" contenteditable="false"><span class="syntax content" contenteditable="true">${escapeHtml(node.text)}</span><img src="${escapeAttr(src)}" alt="${escapeAttr(image.alt)}"${size}></span>`
      }
      const kind = node.text.startsWith('<!--') ? ' class="comment"' : ''
      return `<span data-inline="html"${kind}>${escapeHtml(node.text)}</span>`
    }
    case 'underline':
      return `<span data-inline="underline" class="paired">${syntax(node.open, 'before')}<u>${renderInline(node.children, 'editing', context)}</u>${syntax(node.close, 'after')}</span>`
    case 'hardbreak':
      return `<span data-inline="hardbreak">${syntax(node.text.slice(0, -1))}\n</span>`
    case 'softbreak':
      return `<span data-inline="softbreak">\n</span>`
  }
}

function exported(node: InlineNode, context: DecorateContext): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.text)
    case 'escape':
      return escapeHtml(node.text.slice(1))
    case 'code':
      return `<code>${escapeHtml(node.inner)}</code>`
    case 'emphasis': {
      const tag = EMPHASIS_TAG[node.kind]
      return `<${tag}>${renderInline(node.children, 'export', context)}</${tag}>`
    }
    case 'link': {
      const title = node.title === null ? '' : ` title="${escapeAttr(node.title)}"`
      return `<a href="${escapeAttr(node.href)}"${title}>${renderInline(node.children, 'export', context)}</a>`
    }
    case 'image': {
      const src = context.resolveImage ? context.resolveImage(node.src) : node.src
      const title = node.title === null ? '' : ` title="${escapeAttr(node.title)}"`
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(node.alt)}"${title}>`
    }
    case 'autolink':
      return `<a href="${escapeAttr(node.href)}">${escapeHtml(node.text)}</a>`
    case 'html':
      return node.text
    case 'underline':
      return `<u>${renderInline(node.children, 'export', context)}</u>`
    case 'hardbreak':
      return '<br>\n'
    case 'softbreak':
      return '\n'
  }
}

/** The attributes of a lone `<img …>` tag worth showing (IMG-4), or null for any other HTML. */
function imgTag(text: string): { src: string; alt: string; width: string; height: string } | null {
  if (!/^<img\s[^>]*>$/i.test(text)) return null
  const attr = (name: string) => {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(text)
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
  }
  const src = attr('src')
  if (src.length === 0 || /^\s*javascript:/i.test(src)) return null
  return { src, alt: attr('alt'), width: attr('width'), height: attr('height') }
}
