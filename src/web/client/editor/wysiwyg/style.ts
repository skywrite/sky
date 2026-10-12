/**
 * Inline styling on a block's text (architecture §11.2) and the auto-pairing decisions (§11.3).
 * Offsets count source characters, hidden markers included; the caller re-renders.
 */

import { type InlineNode, type LexContext, lexInline, plainText, sourceOf } from './lexer.ts'

export type StyleKind = 'strong' | 'em' | 'strike' | 'highlight' | 'code' | 'underline' | 'link' | 'image'

export interface Style {
  kind: StyleKind
  open: string
  close: string
}

export const STYLES: Record<StyleKind, Style> = {
  strong: { kind: 'strong', open: '**', close: '**' },
  em: { kind: 'em', open: '*', close: '*' },
  strike: { kind: 'strike', open: '~~', close: '~~' },
  highlight: { kind: 'highlight', open: '==', close: '==' },
  code: { kind: 'code', open: '`', close: '`' },
  underline: { kind: 'underline', open: '<u>', close: '</u>' },
  link: { kind: 'link', open: '[', close: '](' },
  image: { kind: 'image', open: '![', close: '](' },
}

export interface Styled {
  text: string
  start: number
  end: number
}

interface Found {
  start: number
  end: number
  /** Where the construct's content begins and ends within the text. */
  contentStart: number
  contentEnd: number
  /** What the construct becomes when its markers go. */
  stripped: string
}

const WORD_RE = /[\p{L}\p{N}_']/u

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_RE.test(ch)
}

/** The construct of `kind` around [start, end], innermost first, or null. */
function findActive(nodes: InlineNode[], base: number, kind: StyleKind, start: number, end: number): Found | null {
  let offset = base
  for (const node of nodes) {
    const length = sourceOf(node).length
    const nodeStart = offset
    const nodeEnd = offset + length
    offset = nodeEnd
    if (start < nodeStart || end > nodeEnd) continue
    let inner: Found | null = null
    let here: Found | null = null
    if (node.type === 'emphasis') {
      inner = findActive(node.children, nodeStart + node.delim.length, kind, start, end)
      if (node.kind === kind) {
        here = {
          start: nodeStart,
          end: nodeEnd,
          contentStart: nodeStart + node.delim.length,
          contentEnd: nodeEnd - node.delim.length,
          stripped: sourceOf(node).slice(node.delim.length, length - node.delim.length),
        }
      }
    } else if (node.type === 'underline') {
      inner = findActive(node.children, nodeStart + node.open.length, kind, start, end)
      if (kind === 'underline') {
        here = {
          start: nodeStart,
          end: nodeEnd,
          contentStart: nodeStart + node.open.length,
          contentEnd: nodeEnd - node.close.length,
          stripped: sourceOf(node).slice(node.open.length, length - node.close.length),
        }
      }
    } else if (node.type === 'code' && kind === 'code') {
      const before = node.open.length + node.pre.length
      here = {
        start: nodeStart,
        end: nodeEnd,
        contentStart: nodeStart + before,
        contentEnd: nodeEnd - node.close.length - node.post.length,
        stripped: node.inner,
      }
    } else if (node.type === 'link') {
      inner = findActive(node.children, nodeStart + 1, kind, start, end)
      if (kind === 'link') {
        const content = node.children.reduce((sum, child) => sum + sourceOf(child).length, 0)
        here = {
          start: nodeStart,
          end: nodeEnd,
          contentStart: nodeStart + 1,
          contentEnd: nodeStart + 1 + content,
          stripped: sourceOf(node).slice(1, 1 + content),
        }
      }
    } else if (node.type === 'image' && kind === 'image') {
      here = { start: nodeStart, end: nodeEnd, contentStart: nodeStart, contentEnd: nodeEnd, stripped: node.alt }
    }
    if (inner) return inner
    if (here) return here
  }
  return null
}

/** The word around a caret: letters, digits, underscores and apostrophes. */
export function wordAt(text: string, offset: number): [number, number] {
  let start = offset
  let end = offset
  while (start > 0 && isWordChar(text[start - 1])) start--
  while (end < text.length && isWordChar(text[end])) end++
  return [start, end]
}

/**
 * Toggles a style over [start, end] of `text` (FMT-1 … FMT-4): an active construct loses its
 * markers; a caret in a word wraps the word; a caret at a boundary gets an empty pair to type
 * into; a selection is wrapped line by line with its outer whitespace left outside. Links and
 * images take `url` as their target, leaving the caret in the parentheses when there is none.
 */
export function toggleStyle(
  text: string,
  start: number,
  end: number,
  style: Style,
  context: LexContext = {},
  url = '',
): Styled {
  const active = findActive(lexInline(text, context), 0, style.kind, start, end)
  if (active) {
    const next = text.slice(0, active.start) + active.stripped + text.slice(active.end)
    const shift = active.contentStart - active.start
    const from = Math.max(active.start, start - shift)
    const to = Math.min(active.start + active.stripped.length, Math.max(from, end - shift))
    return { text: next, start: from, end: to }
  }
  let from = start
  let to = end
  if (from === to) {
    // A caret in a word wraps the word (FMT-2); a link or image with no selection is an empty one (FMT-4).
    if (style.kind !== 'link' && style.kind !== 'image') [from, to] = wordAt(text, from)
    if (from === to) return insertPair(text, from, style, url)
  }
  while (from < to && /\s/.test(text[from]!)) from++
  while (to > from && /\s/.test(text[to - 1]!)) to--
  if (from === to) return insertPair(text, start, style, url)
  const close = style.kind === 'link' || style.kind === 'image' ? `${style.close}${url})` : style.close
  const lines: Array<[number, number]> = []
  let lineStart = from
  for (let i = from; i < to; i++) {
    if (text[i] === '\n') {
      lines.push([lineStart, i])
      lineStart = i + 1
    }
  }
  lines.push([lineStart, to])
  let next = text
  for (const [a, b] of [...lines].reverse()) {
    if (a === b) continue
    next = next.slice(0, a) + style.open + next.slice(a, b) + close + next.slice(b)
  }
  const wrapped = lines.filter(([a, b]) => a !== b).length
  if ((style.kind === 'link' || style.kind === 'image') && url.length === 0) {
    // The caret waits inside the empty parentheses of the last link.
    const caret = to + wrapped * style.open.length + (wrapped - 1) * close.length + style.close.length
    return { text: next, start: caret, end: caret }
  }
  return {
    text: next,
    start: from + style.open.length,
    end: to + wrapped * style.open.length + (wrapped - 1) * close.length,
  }
}

function insertPair(text: string, offset: number, style: Style, url: string): Styled {
  if (style.kind === 'link' || style.kind === 'image') {
    const pair = `${style.open}${style.close}${url})`
    const caret = offset + style.open.length
    return { text: text.slice(0, offset) + pair + text.slice(offset), start: caret, end: caret }
  }
  const caret = offset + style.open.length
  return { text: text.slice(0, offset) + style.open + style.close + text.slice(offset), start: caret, end: caret }
}

/** Every inline marker gone (FMT-5): links keep their text, images their alt text. */
export function clearFormatting(text: string, context: LexContext = {}): string {
  return plainText(lexInline(text, context))
}

// --- auto-pairing (§11.3) ---------------------------------------------------------------------

const BRACKET_PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" }
const EXTENDED_PAIRS = new Set(['*', '_', '`', '~', '='])
const CLOSERS = new Set([')', ']', '}', '"', "'", ...EXTENDED_PAIRS])

export function pairOf(ch: string): string | null {
  if (ch in BRACKET_PAIRS) return BRACKET_PAIRS[ch]!
  return EXTENDED_PAIRS.has(ch) ? ch : null
}

export function isCloser(ch: string): boolean {
  return CLOSERS.has(ch)
}

/** The line of `text` the offset is on, and the offset within it. */
function lineAround(text: string, offset: number): [string, number] {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = text.indexOf('\n', offset)
  return [text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd), offset - lineStart]
}

/**
 * Should a typed opener get its partner inserted after the caret (TYP-19, TYP-20)? Never after a
 * backslash, before a letter, digit, opener or quote, for a quote right after a word or one that
 * closes an open quote on the line, for a marker that is not at a word boundary or that would be
 * a closer, or inside a code span (except a backtick).
 */
export function shouldPair(ch: string, text: string, offset: number): boolean {
  const partner = pairOf(ch)
  if (!partner) return false
  const prev = text[offset - 1]
  const next = text[offset]
  if (prev === '\\') return false
  if (next !== undefined && (isWordChar(next) || next in BRACKET_PAIRS || EXTENDED_PAIRS.has(next))) return false
  const [line, at] = lineAround(text, offset)
  const before = line.slice(0, at)
  const count = (needle: string) => before.split(needle).length - 1
  if (ch === '"' || ch === "'") {
    if (isWordChar(prev)) return false
    return count(ch) % 2 === 0
  }
  if (EXTENDED_PAIRS.has(ch)) {
    // A run of the same marker (`**`, a fence's ```) is typed by hand, one at a time.
    if (isWordChar(prev) || prev === ch) return false
    if (ch !== '`' && count('`') % 2 === 1) return false
    return count(ch) % 2 === 0
  }
  return true
}
