/**
 * Model → DOM (architecture §5): one element per block, carrying its node id and type; inline
 * leaves hold the editing decorator's output so their textContent is their markdown; verbatim
 * leaves hold their text in a <pre>; rules and tables are non-editable islands.
 */

import { type DecorateContext, renderInline } from './decorate.ts'
import { highlightCode } from './highlight.ts'
import { escapeAttr, escapeHtml } from './html.ts'
import { type LexContext, lexInline } from './lexer.ts'
import type { MarkdownDocument, Node } from './model.ts'
import { previewMarker } from './parser.ts'

export interface RenderContext extends DecorateContext, LexContext {}

export function contextFor(doc: MarkdownDocument, resolveImage?: (src: string) => string): RenderContext {
  return {
    resolveImage,
    findDefinition(label) {
      const definition = doc.findDefinition(label)
      return definition ? { href: definition.href ?? '', title: definition.title ?? null } : null
    },
  }
}

export function renderDocument(doc: MarkdownDocument, context: RenderContext): string {
  return doc.blocks.map((block) => renderBlock(block, context)).join('')
}

/**
 * The inner HTML of an inline leaf: the editing rendering, with a line box where text alone gives
 * none. A paragraph previewing a block marker (TYP-14) shows that marker muted.
 */
export function renderInlineContent(node: Node, context: RenderContext): string {
  const nodes = lexInline(node.text, context)
  const preview = node.type === 'paragraph' ? previewMarker(node.text) : null
  const first = nodes[0]
  let prefix = ''
  if (preview && preview.marker.length > 0 && first?.type === 'text' && first.text.startsWith(preview.marker)) {
    prefix = `<span data-inline="block-like"><span class="block-syntax">${escapeHtml(preview.marker)}</span></span>`
    first.text = first.text.slice(preview.marker.length)
  }
  const html = prefix + renderInline(nodes, 'editing', context)
  if (html.length === 0) return '<br>'
  return node.text.endsWith('\n') ? `${html}<br>` : html
}

/** The attribute a paragraph carries while it previews a block type (TYP-18), or an empty string. */
export function looksLikeAttr(node: Node): string {
  const preview = node.type === 'paragraph' ? previewMarker(node.text) : null
  return preview ? ` data-looks-like="${preview.looksLike}"` : ''
}

/** The text of a verbatim leaf as <pre> content: an extra newline guards the one the parser eats. */
export function renderVerbatimContent(text: string): string {
  if (text.length === 0) return '<br>'
  const guarded = text.startsWith('\n') ? `\n${text}` : text
  return escapeHtml(guarded) + (text.endsWith('\n') ? '<br>' : '')
}

/** The fence's language box (FEN-1): chrome inside the block, editable on its own. */
export function renderLanguageBox(lang: string): string {
  return `<span class="fence-lang" data-chrome contenteditable="false"><span contenteditable="true" spellcheck="false">${escapeHtml(lang)}</span></span>`
}

/** The code of a fence as <pre> content: colored when its language is known (FEN-1), guarded like any verbatim text. */
export function renderFenceContent(text: string, lang: string | undefined): string {
  if (text.length === 0) return '<br>'
  const guarded = text.startsWith('\n') ? `\n${text}` : text
  const body = highlightCode(guarded, lang) ?? escapeHtml(guarded)
  return body + (text.endsWith('\n') ? '<br>' : '')
}

/** Everything inside a fence's <pre>: the language box, then the code. */
export function renderFenceInner(node: Node): string {
  return renderLanguageBox(node.lang ?? '') + renderFenceContent(node.text, node.lang)
}

/** Very long blocks are not spell-checked (MODE-7). */
const SPELLCHECK_LIMIT = 10_000

export function renderBlock(node: Node, context: RenderContext): string {
  const attrs = `data-node="${node.id}" data-type="${node.type}"${node.text.length > SPELLCHECK_LIMIT ? ' spellcheck="false"' : ''}`
  switch (node.type) {
    case 'paragraph':
      return `<p ${attrs} class="end-block"${looksLikeAttr(node)}>${renderInlineContent(node, context)}</p>`
    case 'heading': {
      const tag = `h${Math.min(6, Math.max(1, node.depth ?? 1))}`
      return `<${tag} ${attrs} class="end-block">${renderInlineContent(node, context)}</${tag}>`
    }
    case 'blockquote':
      return `<blockquote ${attrs}>${renderChildren(node, context)}</blockquote>`
    case 'list': {
      const tight = node.loose ? '' : ' class="tight"'
      if (node.style === 'ol') {
        return `<ol ${attrs} start="${node.start ?? 1}"${tight}>${renderChildren(node, context)}</ol>`
      }
      return `<ul ${attrs} data-bullet="${escapeAttr(node.bullet ?? '-')}"${tight}>${renderChildren(node, context)}</ul>`
    }
    case 'list_item': {
      if (node.checked === null || node.checked === undefined) {
        return `<li ${attrs}>${renderChildren(node, context)}</li>`
      }
      const box = `<input type="checkbox" contenteditable="false" tabindex="-1"${node.checked ? ' checked' : ''}>`
      return `<li ${attrs} class="task${node.checked ? ' done' : ''}">${box}${renderChildren(node, context)}</li>`
    }
    case 'fence':
      return `<pre ${attrs} class="end-block verbatim fence" spellcheck="false">${renderFenceInner(node)}</pre>`
    case 'html':
      return `<pre ${attrs} class="end-block verbatim html" spellcheck="false">${renderVerbatimContent(node.text)}</pre>`
    case 'frontmatter':
      return `<pre ${attrs} class="end-block verbatim frontmatter" spellcheck="false">${renderVerbatimContent(node.text)}</pre>`
    case 'definition':
      return `<pre ${attrs} class="end-block verbatim definition" spellcheck="false">${renderVerbatimContent(node.text)}</pre>`
    case 'hr':
      return `<div ${attrs} class="atom" contenteditable="false" tabindex="-1"><hr></div>`
    case 'table': {
      const rows = node.children
      const head = rows.filter((row) => row.header)
      const body = rows.filter((row) => !row.header)
      const section = (list: Node[], tag: string) =>
        list.length === 0 ? '' : `<${tag}>${list.map((row) => renderBlock(row, context)).join('')}</${tag}>`
      return `<figure ${attrs} contenteditable="false"><table>${section(head, 'thead')}${section(body, 'tbody')}</table></figure>`
    }
    case 'table_row': {
      const align = node.parent?.align ?? []
      const cellTag = node.header ? 'th' : 'td'
      const cells = node.children
        .map((cell, index) => {
          const style = align[index] ? ` style="text-align:${align[index]}"` : ''
          return `<${cellTag}${style}>${renderBlock(cell, context)}</${cellTag}>`
        })
        .join('')
      return `<tr ${attrs}>${cells}</tr>`
    }
    case 'table_cell':
      return `<span ${attrs} class="end-block" contenteditable="true">${renderInlineContent(node, context)}</span>`
    case 'document':
      return renderChildren(node, context)
  }
}

function renderChildren(node: Node, context: RenderContext): string {
  return node.children.map((child) => renderBlock(child, context)).join('')
}

// --- export: clean semantic HTML for the clipboard (§13.3, RT-13) ---------------------------

export function renderExport(nodes: Node[], context: RenderContext): string {
  return nodes.map((node) => exportBlock(node, context)).join('\n')
}

function exportInline(node: Node, context: RenderContext): string {
  return renderInline(lexInline(node.text, context), 'export', context)
}

function exportBlock(node: Node, context: RenderContext): string {
  const children = () => node.children.map((child) => exportBlock(child, context)).join('\n')
  switch (node.type) {
    case 'paragraph':
      return `<p>${exportInline(node, context)}</p>`
    case 'heading': {
      const tag = `h${Math.min(6, Math.max(1, node.depth ?? 1))}`
      return `<${tag}>${exportInline(node, context)}</${tag}>`
    }
    case 'blockquote':
      return `<blockquote>${children()}</blockquote>`
    case 'list':
      return node.style === 'ol' ? `<ol start="${node.start ?? 1}">${children()}</ol>` : `<ul>${children()}</ul>`
    case 'list_item': {
      const box = node.checked == null ? '' : `<input type="checkbox" disabled${node.checked ? ' checked' : ''}> `
      const inner = node.children
        .map((child, index) =>
          index === 0 && child.type === 'paragraph' && !node.parent?.loose
            ? exportInline(child, context)
            : exportBlock(child, context),
        )
        .join('\n')
      return `<li>${box}${inner}</li>`
    }
    case 'fence':
      return `<pre><code${node.lang ? ` class="language-${escapeAttr(node.lang.split(/\s/)[0] ?? '')}"` : ''}>${escapeHtml(node.text)}</code></pre>`
    case 'html':
      return node.text
    case 'frontmatter':
    case 'definition':
      return ''
    case 'hr':
      return '<hr>'
    case 'table': {
      const rows = node.children
      const align = node.align ?? []
      const row = (r: Node, tag: string) =>
        `<tr>${r.children.map((cell, i) => `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ''}>${exportInline(cell, context)}</${tag}>`).join('')}</tr>`
      const head = rows
        .filter((r) => r.header)
        .map((r) => row(r, 'th'))
        .join('')
      const body = rows
        .filter((r) => !r.header)
        .map((r) => row(r, 'td'))
        .join('')
      return `<table>${head ? `<thead>${head}</thead>` : ''}${body ? `<tbody>${body}</tbody>` : ''}</table>`
    }
    case 'table_row':
    case 'table_cell':
    case 'document':
      return children()
  }
}
