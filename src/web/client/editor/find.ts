/**
 * Find in an open document, for the explorer's find and replace. A document is searched block by
 * block, in the text a reader sees. In the editor every markdown character is in the DOM with the
 * syntax hidden (wysiwyg/decorate.ts); find skips that hidden text, so a link's address or a `**`
 * never matches, and a match never runs across one — except an escape's backslash, which belongs
 * to the character it shows. A match in the editor carries the stretch of markdown it covers,
 * which is what a replace rewrites. Matches are painted with the CSS Custom Highlight API: nothing
 * is added to the page, so the editor's DOM and the reader's selection stay as they are.
 */

import { LEAF_SELECTOR, textWalker } from './wysiwyg/bookmark.ts'
import type { TextEdit } from './wysiwyg/mod.ts'

export interface FindOptions {
  matchCase: boolean
  wholeWord: boolean
}

const WORD = '[\\p{L}\\p{N}_]'

/** The pattern a query finds, or null when there is nothing to look for. A space matches any run of whitespace. */
export function findPattern(query: string, options: FindOptions): RegExp | null {
  if (query.trim() === '') return null
  const source = query
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  const bounded = options.wholeWord ? `(?<!${WORD})(?:${source})(?!${WORD})` : source
  return new RegExp(bounded, options.matchCase ? 'gu' : 'giu')
}

/** Where a pattern matches in a text, as [start, end) pairs. */
export function matchesIn(text: string, pattern: RegExp): Array<[number, number]> {
  const found: Array<[number, number]> = []
  pattern.lastIndex = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match[0].length === 0) {
      pattern.lastIndex++
      continue
    }
    found.push([match.index, match.index + match[0].length])
  }
  return found
}

/** A stretch of one block's visible text that sits in a single text node. */
export interface Piece {
  /** Where it starts in the block's visible text */
  at: number
  length: number
  /** Where it starts in the block's markdown, hidden syntax counted */
  source: number
  /** An escape's hidden backslash sits right before it */
  afterEscape: boolean
}

/**
 * The markdown a match of the visible text covers, or null when hidden syntax sits inside it. A
 * match that starts on an escaped character takes the backslash along, so a replace leaves none
 * behind.
 */
export function sourceSpan(pieces: Piece[], start: number, end: number): { start: number; end: number } | null {
  let first = -1
  let last = -1
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!
    if (first === -1 && start < piece.at + piece.length) first = i
    if (end <= piece.at + piece.length) {
      last = i
      break
    }
  }
  if (first === -1 || last === -1) return null
  for (let i = first + 1; i <= last; i++) {
    const before = pieces[i - 1]!
    const piece = pieces[i]!
    const hidden = piece.source - (before.source + before.length)
    if (hidden !== 0 && !(hidden === 1 && piece.afterEscape)) return null
  }
  const head = pieces[first]!
  const tail = pieces[last]!
  const from = head.source + (start - head.at) - (start === head.at && head.afterEscape ? 1 : 0)
  return { start: from, end: tail.source + (end - tail.at) }
}

/** One block's visible text, with the text nodes it came from. */
interface Run {
  block: HTMLElement
  text: string
  pieces: Piece[]
  nodes: Text[]
  /** The block's whole markdown, hidden syntax included — the editor's blocks only */
  markdown: string
}

/** Text the editor keeps in the DOM but hides: markers, link addresses, image sources, a previewed block's marker. */
const HIDDEN = '.syntax, .content, .block-syntax'

/** Where a rendered document's text breaks into blocks. */
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, figcaption, summary'

function editorRuns(root: HTMLElement): Run[] {
  const runs: Run[] = []
  for (const block of root.querySelectorAll<HTMLElement>(`${LEAF_SELECTOR}[data-node]`)) {
    const run: Run = { block, text: '', pieces: [], nodes: [], markdown: '' }
    const walker = textWalker(block)
    let afterEscape = false
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const source = run.markdown.length
      run.markdown += node.data
      const hidden = node.parentElement?.closest(HIDDEN)
      if (hidden && block.contains(hidden)) {
        afterEscape = node.data === '\\' && hidden.parentElement?.dataset.inline === 'escape'
        continue
      }
      if (node.data.length > 0) {
        run.pieces.push({ at: run.text.length, length: node.data.length, source, afterEscape })
        run.nodes.push(node)
        run.text += node.data
      }
      afterEscape = false
    }
    if (run.text.length > 0) runs.push(run)
  }
  return runs
}

function readerRuns(root: HTMLElement): Run[] {
  const runs: Run[] = []
  let run: Run | null = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.data.length === 0) continue
    const found = node.parentElement?.closest<HTMLElement>(BLOCKS)
    const block = found && root.contains(found) ? found : null
    // The line breaks between blocks are no one's text.
    if (!block && node.data.trim() === '') continue
    const owner = block ?? root
    if (!run || run.block !== owner) {
      run = { block: owner, text: '', pieces: [], nodes: [], markdown: '' }
      runs.push(run)
    }
    run.pieces.push({ at: run.text.length, length: node.data.length, source: run.text.length, afterEscape: false })
    run.nodes.push(node)
    run.text += node.data
  }
  return runs
}

/** The live range over [start, end) of a run's visible text. */
function rangeOver(run: Run, start: number, end: number): Range {
  const range = document.createRange()
  let first = 0
  while (first < run.pieces.length - 1 && start >= run.pieces[first]!.at + run.pieces[first]!.length) first++
  let last = first
  while (last < run.pieces.length - 1 && end > run.pieces[last]!.at + run.pieces[last]!.length) last++
  range.setStart(run.nodes[first]!, start - run.pieces[first]!.at)
  range.setEnd(run.nodes[last]!, end - run.pieces[last]!.at)
  return range
}

export interface Match {
  range: Range
  /** In the editor: the markdown it covers, which a replace rewrites; null in a rendered document */
  edit: TextEdit | null
  /** Its block's place among the document's blocks, and where it starts in the block's visible text */
  block: number
  start: number
}

/**
 * Every match in a document: the editor's root (`.sky-wysiwyg`) or a rendered body. A match in the
 * editor that hidden syntax splits is left out — it could not be replaced without breaking it.
 */
export function findMatches(root: HTMLElement, pattern: RegExp): Match[] {
  const editing = root.classList.contains('sky-wysiwyg')
  const runs = editing ? editorRuns(root) : readerRuns(root)
  const matches: Match[] = []
  runs.forEach((run, block) => {
    for (const [start, end] of matchesIn(run.text, pattern)) {
      let edit: TextEdit | null = null
      if (editing) {
        const span = sourceSpan(run.pieces, start, end)
        if (!span) continue
        edit = { blockId: run.block.dataset.node ?? '', ...span, expect: run.markdown.slice(span.start, span.end) }
      }
      matches.push({ range: rangeOver(run, start, end), edit, block, start })
    }
  })
  return matches
}

const ALL = 'sky-find'
const CURRENT = 'sky-find-current'

function registry(): HighlightRegistry | null {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined' ? CSS.highlights : null
}

/** Paints every match, the current one stronger. A browser without highlights paints none; stepping still scrolls. */
export function paintMatches(matches: Match[], current: number) {
  const highlights = registry()
  if (!highlights) return
  const all = new Highlight()
  for (const match of matches) all.add(match.range)
  highlights.set(ALL, all)
  const focused = matches[current]
  if (!focused) {
    highlights.delete(CURRENT)
    return
  }
  const one = new Highlight(focused.range)
  one.priority = 1
  highlights.set(CURRENT, one)
}

export function clearMatches() {
  const highlights = registry()
  highlights?.delete(ALL)
  highlights?.delete(CURRENT)
}
