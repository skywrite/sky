/**
 * The editor (architecture §6): one contenteditable root holding the rendered document. The
 * browser does the typing; the editor learns which block changed, re-lexes it 200 ms later, swaps
 * the block's HTML only when the rendering differs, puts the caret back by character offset, and
 * reveals the syntax of the construct under the caret. Structure — Enter, Backspace and Delete at
 * block edges, selections across blocks, Tab — is the editor's own (§8), each step a command on
 * its own undo stack (§9). Saves go out a second after the last edit; the file on disk is polled
 * for outside changes.
 */

import { fetchSnapshot, saveDocument } from './api.ts'
import {
  type Bookmark,
  bookmarkFromSelection,
  elementFor,
  inChrome,
  leafElementAt,
  offsetIn,
  positionAt,
  rangeFromBookmark,
  rangeOverText,
  selectRange,
  selectedLeaf,
  textOf,
} from './bookmark.ts'
import { type ListKind, moveBlock, setHeading, toggleList, toggleQuote } from './commands.ts'
import { renderInline } from './decorate.ts'
import { backspaceAtStart, deleteAcross, deleteAtEnd, widenSelection } from './delete.ts'
import { highlightLanguage } from './highlight.ts'
import { type Anchors, type Command, History } from './history.ts'
import { escapeHtml } from './html.ts'
import { htmlToMarkdown, looksLikeMarkdown } from './importer.ts'
import { type InlineNode, lexInline, sourceOf } from './lexer.ts'
import { indentItem, outdentItem, unnest } from './lists.ts'
import { MarkdownDocument, type Node, type NodeJson } from './model.ts'
import { caretRect, cellUnder, islandsOf, onEdgeLine, positionFromPoint } from './navigate.ts'
import { parseDocument, parseInto } from './parser.ts'
import { pasteText } from './paste.ts'
import {
  contextFor,
  looksLikeAttr,
  type RenderContext,
  renderDocument,
  renderExport,
  renderFenceInner,
  renderInlineContent,
  renderVerbatimContent,
} from './render.ts'
import { serializeDocument } from './serializer.ts'
import { splitBlock } from './split.ts'
import { anchorsAround, commitBlock, convertImmediate, storeVerbatim, syncRange } from './structure.ts'
import { clearFormatting, isCloser, pairOf, shouldPair, type Style, STYLES, toggleStyle } from './style.ts'
import {
  cellAt,
  cellBelow,
  cellPosition,
  columnCount,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  nextCell,
  previousCell,
  setAlignment,
} from './tables.ts'

export interface EditorState {
  /** The content API for the file: GET for version/content, PUT to save. */
  apiPath: string
  /** The attach API for the file: PUT a file's bytes with `?name=` to store it beside the document (CLP-16). */
  attachPath?: string
  content: string
  version: number
  resolveImage?: (src: string) => string
  /** The front matter belongs to the properties panel: its block is not rendered, its text goes through the handle. */
  hideFrontmatter?: boolean
  /** The host owns Save; no file API, polling, or autosave in this mode. */
  local?: boolean
}

export type EditorStatusKind = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

export interface EditorHooks {
  /** Current Markdown after local edits, without waiting for a disk save. */
  onChange?(content: string): void
  onStatus(kind: EditorStatusKind, text: string): void
  onConflict(visible: boolean): void
  /** The front matter text changed by any path but the handle — undo, a reload, typing `---`; null when the block is gone. */
  onFrontmatter?(text: string | null): void
  /** The caret tried to leave the document upward — Up or Left at its start — and there is nothing above but the panel. */
  onReachTop?(): void
}

export type EditorFormat = 'bold' | 'italic' | 'heading' | 'paragraph' | 'bullets' | 'undo' | 'redo'

export interface EditorHandle {
  content(): string
  format(command: EditorFormat): void
  /** Drop local changes and show the file as it is on disk. */
  reload(): void
  /** Save over a file that changed on disk. */
  overwrite(): void
  /** The front matter body (between the `---` lines), or null when the document has none. */
  frontmatter(): string | null
  /** Sets the front matter body as one undo step; null removes the block. */
  setFrontmatter(text: string | null): void
  /** Puts the caret at the start of the first block the panel does not own. */
  focusStart(): void
  destroy(): void
}

const REPAINT_MS = 200
/** Busy mode (§15, MODE-4): documents this large repaint slower and keep one block editable at a time. */
const BUSY_REPAINT_MS = 500
const BUSY_LEAVES = 1500
const BUSY_HTML_LENGTH = 400_000
const SAVE_IDLE_MS = 1000
const SAVE_RETRY_MS = 3000
const POLL_MS = 4000
/** Keystrokes of one kind in one block this close together are one undo step (UND-1). */
const TYPING_WINDOW_MS = 3000

export function mountEditor(root: HTMLElement, state: EditorState, hooks: EditorHooks): EditorHandle {
  const editor = new Editor(root, state, hooks)
  return {
    content: () => editor.content(),
    format: (command) => editor.format(command),
    reload: () => void editor.reloadFromDisk('Reloaded disk version'),
    overwrite: () => void editor.save(true),
    frontmatter: () => editor.frontmatterText(),
    setFrontmatter: (text) => editor.setFrontmatter(text),
    focusStart: () => editor.focusStart(),
    destroy: () => editor.destroy(),
  }
}

type Listener = { target: EventTarget; type: string; handler: EventListener }

/** What a structural step reports: nothing happened, or where the caret goes. */
type Outcome = { caret: Bookmark | null } | null

interface TypingRun {
  id: string
  kind: string
  before: { text: string; cursor: Bookmark | null }
  at: number
  /** Where the run last left the caret; a caret found elsewhere ends the run. */
  lastCaret: Bookmark | null
}

function at(blockId: string, start: number, end = start): Bookmark {
  return { blockId, start, end }
}

interface PasteTarget {
  start: Node
  startOffset: number
  end: Node
  endOffset: number
  collapsed: boolean
}

/** A file name as a link destination: what would end or break the parentheses percent-encoded. */
function linkDestination(name: string): string {
  return name.replace(/[ ()<>%\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

/** A file name as link text: brackets, backslashes, and the markers that would format it escaped. */
function escapeLinkText(name: string): string {
  return name.replace(/[[\]\\*`]/g, (c) => `\\${c}`)
}

class Editor {
  private readonly doc: MarkdownDocument
  private context: RenderContext
  /** What the panel was last told the front matter is */
  private lastFrontmatter: string | null | undefined
  private version: number
  private dirty = false
  private saving = false
  private conflict = false
  private destroyed = false
  private composing = false
  private mouseDown = false
  private focusedId: string | null = null
  /** A paragraph whose caret sat at the end of its previewed heading marker (§6.5 step 6). */
  private armed: string | null = null
  /** The paragraph a click below the document made; it goes if left empty (NAV-13). */
  private temporary: string | null = null
  /** The rule selected as a whole, if any (ATOM). */
  private atom: string | null = null
  /** The x a run of Up/Down keeps aiming for (NAV-4). */
  private goalX: number | null = null
  /** Where an empty pair was just inserted, so another marker there grows it (TYP-24). */
  private pairAt: { id: string; offset: number } | null = null
  /** Cmd+Shift+V: the next paste ignores the HTML flavor (CLP-15). */
  private plainPaste = false
  /** A very large document: only the focused block is an editing host (§15). */
  private busy = false
  private expanded: Element[] = []
  private readonly queue = new Set<string>()
  private readonly history = new History()
  private typing: TypingRun | null = null
  private repaintTimer: number | null = null
  private saveTimer: number | null = null
  private expandFrame: number | null = null
  private readonly pollTimer: number | null
  private readonly listeners: Listener[] = []

  constructor(
    private readonly root: HTMLElement,
    private readonly state: EditorState,
    private readonly hooks: EditorHooks,
  ) {
    this.doc = parseDocument(state.content)
    this.context = contextFor(this.doc, state.resolveImage, state.hideFrontmatter === true)
    this.version = state.version
    this.ensureBlock()
    root.innerHTML = renderDocument(this.doc, this.context)
    root.contentEditable = 'true'
    this.applyBusyMode()
    root.setAttribute('role', 'textbox')
    root.setAttribute('aria-multiline', 'true')
    root.spellcheck = true

    this.listen(root, 'beforeinput', (event) => this.onBeforeInput(event as InputEvent))
    this.listen(root, 'input', () => this.onInput())
    this.listen(root, 'keydown', (event) => this.onKeyDown(event as KeyboardEvent))
    this.listen(root, 'compositionstart', () => {
      this.composing = true
    })
    this.listen(root, 'compositionend', () => {
      this.composing = false
      this.onInput()
    })
    this.listen(root, 'mousedown', (event) => this.onMouseDown(event as MouseEvent))
    this.listen(document, 'mouseup', () => {
      this.mouseDown = false
      this.setIslandsEditable(false)
      this.scheduleExpand()
    })
    this.listen(document, 'selectionchange', () => this.onSelectionChange())
    this.listen(root, 'click', (event) => this.onClick(event as MouseEvent))
    this.listen(root, 'copy', (event) => this.onCopy(event as ClipboardEvent, false))
    this.listen(root, 'cut', (event) => this.onCopy(event as ClipboardEvent, true))
    this.listen(root, 'paste', (event) => this.onPaste(event as ClipboardEvent))
    this.listen(root, 'dragstart', (event) => event.preventDefault())
    this.listen(root, 'drop', (event) => this.onDrop(event as DragEvent))
    this.listen(root, 'focusout', (event) => {
      const target = event.target
      const leaf = target instanceof Element ? leafElementAt(target) : null
      if (leaf && target instanceof Element && target.closest('.fence-lang')) this.commitLanguage(leaf, 'stay')
    })
    this.listen(root, 'change', (event) => this.onChange(event))
    this.pollTimer = state.local ? null : window.setInterval(() => void this.poll(), POLL_MS)
    hooks.onStatus('saved', 'Saved')
  }

  private listen(target: EventTarget, type: string, handler: EventListener) {
    target.addEventListener(type, handler)
    this.listeners.push({ target, type, handler })
  }

  /** A document is never without a block to type into (TYP-34). */
  private ensureBlock() {
    if (this.doc.blocks.some((block) => block.type !== 'frontmatter')) return
    this.doc.root.appendChild(this.doc.createNode('paragraph'))
  }

  // --- input -----------------------------------------------------------------------------------

  private onBeforeInput(event: InputEvent) {
    const type = event.inputType
    const pairAt = this.pairAt
    this.pairAt = null
    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault()
      if (type === 'historyUndo') this.undo()
      else this.redo()
      return
    }
    if (type.startsWith('format')) {
      event.preventDefault()
      return
    }
    const selection = document.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const leaf = selectedLeaf(this.root)
    const bookmark = bookmarkFromSelection(this.root)
    if (!leaf?.dataset.node || !range || !bookmark) {
      event.preventDefault()
      return
    }
    const id = leaf.dataset.node
    if (inChrome(range.startContainer)) {
      // Typing in a block's chrome (a fence's language box) is the box's own; Enter commits it.
      if (type === 'insertParagraph' || type === 'insertLineBreak') {
        event.preventDefault()
        this.commitLanguage(leaf, 'code')
      } else if (type.startsWith('insertFrom') || type === 'insertParagraph') event.preventDefault()
      return
    }

    if (!range.collapsed) {
      // Every edit over a selection begins by deleting it through the editor (§6.2 step 2).
      event.preventDefault()
      if (type === 'insertText' && event.data?.length === 1 && this.wrapSelection(event.data)) return
      this.deleteSelection()
      if (type === 'insertText' && event.data) this.insertText(event.data)
      else if (type === 'insertParagraph') this.enter(false, false)
      else if (type === 'insertLineBreak') this.enter(true, false)
      return
    }
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault()
      this.enter(type === 'insertLineBreak', false)
      return
    }
    if (type === 'insertFromPaste' || type === 'insertFromDrop') {
      // The paste and drop events carry the flavors; nothing reaches the DOM from here.
      event.preventDefault()
      return
    }
    if (type.startsWith('delete')) {
      const backward = type.endsWith('Backward')
      const length = textOf(leaf).length
      if (backward && bookmark.start === 0) {
        event.preventDefault()
        this.backspaceAtStart()
        return
      }
      if (!backward && bookmark.start >= length) {
        event.preventDefault()
        this.deleteAtEnd()
        return
      }
      if (backward && this.removePair(leaf, bookmark.start)) {
        event.preventDefault()
        return
      }
      this.beginTyping(id, 'delete')
      return
    }
    if (
      type === 'insertText' &&
      event.data &&
      event.data.length === 1 &&
      this.autoPair(event.data, leaf, bookmark, pairAt)
    ) {
      event.preventDefault()
      return
    }
    this.beginTyping(id, type === 'insertReplacementText' ? 'replace' : 'add')
  }

  /**
   * Auto-pairing (§11.3): a closer already there is stepped over (TYP-21); a marker typed between
   * a pair of itself extends it to a double (TYP-24); an opener gets its partner after the caret
   * when the text around it allows (TYP-19, TYP-20). True when the keystroke was handled.
   */
  private autoPair(
    ch: string,
    leaf: HTMLElement,
    bookmark: Bookmark,
    pairAt: { id: string; offset: number } | null,
  ): boolean {
    const id = leaf.dataset.node ?? ''
    const node = this.doc.getNode(id)
    if (!node?.isInline()) return false
    const text = textOf(leaf)
    const offset = bookmark.start
    if (isCloser(ch) && text[offset] === ch) {
      if ('*_~'.includes(ch) && text[offset - 1] === ch && pairAt?.id === id && pairAt.offset === offset) {
        // `*|*` just paired and another `*`: the pair grows to `**|**`.
        this.replaceSelectionWith(ch + ch, 1, 1)
        this.pairAt = { id, offset: offset + 1 }
        return true
      }
      this.beginTyping(leaf.dataset.node!, 'add')
      const [positionNode, positionOffset] = positionAt(leaf, offset + 1)
      document.getSelection()?.collapse(positionNode, positionOffset)
      this.expandAtSelection()
      return true
    }
    const partner = pairOf(ch)
    if (!partner || !shouldPair(ch, text, offset)) return false
    this.replaceSelectionWith(ch + partner, 1, 1)
    this.pairAt = { id, offset: offset + 1 }
    return true
  }

  /** Typing an opener over a selection wraps it and keeps the inner text selected (TYP-22). */
  private wrapSelection(ch: string): boolean {
    const partner = pairOf(ch)
    if (!partner) return false
    const selection = document.getSelection()
    const text = selection?.toString() ?? ''
    if (!selection || text.length === 0) return false
    this.replaceSelectionWith(ch + text + partner, 1, 1 + text.length)
    return true
  }

  /** Backspace right after an opener whose partner is the next character removes both (TYP-23). */
  private removePair(leaf: HTMLElement, offset: number): boolean {
    const text = textOf(leaf)
    const prev = text[offset - 1]
    if (prev === undefined || pairOf(prev) !== text[offset]) return false
    const node = this.doc.getNode(leaf.dataset.node ?? '')
    if (!node?.isInline()) return false
    this.beginTyping(leaf.dataset.node!, 'delete')
    const range = document.createRange()
    const [startNode, startOffset] = positionAt(leaf, offset - 1)
    const [endNode, endOffset] = positionAt(leaf, offset + 1)
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    range.deleteContents()
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    this.afterDomEdit(leaf)
    return true
  }

  /** Replaces the selection with `text`, selecting [start, end] of it, as part of the run of typing. */
  private replaceSelectionWith(text: string, start: number, end: number) {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const leaf = selectedLeaf(this.root)
    if (!leaf?.dataset.node) return
    this.beginTyping(leaf.dataset.node, 'add')
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const inserted = document.createTextNode(text)
    range.insertNode(inserted)
    selection.removeAllRanges()
    const next = document.createRange()
    next.setStart(inserted, start)
    next.setEnd(inserted, end)
    selection.addRange(next)
    this.afterDomEdit(leaf)
  }

  /** What follows any edit the editor made to a block's DOM itself. */
  private afterDomEdit(leaf: HTMLElement) {
    const id = leaf.dataset.node
    if (!id) return
    this.noteTypingCaret()
    this.markDirty()
    this.focusedId = id
    this.queue.delete(id)
    this.repaintBlock(id)
    this.expandAtSelection()
  }

  /** Inserts text at the caret and repaints its block at once, so the caret lands on real text. */
  private insertText(text: string, kind = 'add') {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const leaf = selectedLeaf(this.root)
    if (!leaf?.dataset.node) return
    if (kind === 'paste') this.closeTyping()
    this.beginTyping(leaf.dataset.node, kind)
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    this.noteTypingCaret()
    this.markDirty()
    this.focusedId = leaf.dataset.node
    this.queue.delete(leaf.dataset.node)
    this.repaintBlock(leaf.dataset.node)
    this.expandAtSelection()
    if (kind === 'paste') this.closeTyping()
  }

  private onInput() {
    if (this.destroyed) return
    this.noteTypingCaret()
    const leaf = selectedLeaf(this.root)
    this.refocus(leaf?.dataset.node ?? null)
    if (leaf?.dataset.node) this.queue.add(leaf.dataset.node)
    else
      for (const element of this.root.querySelectorAll<HTMLElement>('.end-block[data-node]'))
        this.queue.add(element.dataset.node!)
    this.markDirty()
    this.scheduleRepaint()
  }

  private onKeyDown(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') this.goalX = null
    if (this.atom && this.onAtomKey(event)) return
    if (!mod && !event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      if (this.moveHorizontal(event.key === 'ArrowRight' ? 1 : -1, event.shiftKey)) event.preventDefault()
      return
    }
    if (event.altKey && event.shiftKey && !mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      // The block swaps with its neighbor (FMT-13).
      event.preventDefault()
      const current = this.current()
      if (!current) return
      const top = current.node.topLevel()
      const direction: -1 | 1 = event.key === 'ArrowUp' ? -1 : 1
      const anchors = anchorsAround(
        ...(top
          ? [direction === -1 ? (top.before ?? top) : top, direction === 1 ? (top.after ?? top) : top]
          : [current.node]),
      )
      this.transact(anchors, current.bookmark, () =>
        moveBlock(current.node, direction) ? { caret: current.bookmark } : null,
      )
      return
    }
    if (!mod && !event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (this.moveVertical(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey)) event.preventDefault()
      return
    }
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
      if (this.selectAll()) event.preventDefault()
      return
    }
    if (mod && event.shiftKey && !event.altKey && event.code === 'KeyV') {
      // The paste that follows takes the plain text (CLP-15).
      this.plainPaste = true
      return
    }
    if (mod && !event.altKey && this.formatShortcut(event)) {
      event.preventDefault()
      return
    }
    if (event.key === 'Tab') {
      // Tab never leaves the editor (TAB-9).
      event.preventDefault()
      const leaf = selectedLeaf(this.root)
      if (leaf && inChrome(document.getSelection()?.anchorNode)) this.commitLanguage(leaf, 'code')
      else this.tab(event.shiftKey)
      return
    }
    if (event.key === 'Escape') {
      const leaf = selectedLeaf(this.root)
      if (leaf && inChrome(document.getSelection()?.anchorNode)) {
        event.preventDefault()
        this.commitLanguage(leaf, 'code', true)
      }
      return
    }
    if (event.key === 'Backspace' && mod && event.shiftKey) {
      if (this.deleteCurrentRow()) event.preventDefault()
      return
    }
    if (event.key === 'Enter' && mod) {
      event.preventDefault()
      this.enter(false, true)
      return
    }
    if (mod && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) this.redo()
      else this.undo()
      return
    }
    if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      this.redo()
      return
    }
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      this.clearSaveTimer()
      void this.save(false)
    }
  }

  private onClick(event: MouseEvent) {
    const anchor = (event.target as Element).closest('a[href]')
    if (anchor && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      window.open(anchor.getAttribute('href') ?? '', '_blank', 'noopener')
      return
    }
    const action = (event.target as Element).closest<HTMLElement>('[data-table-action]')
    if (action?.dataset.tableAction) {
      event.preventDefault()
      this.tableAction(action.dataset.tableAction)
      return
    }
    if (event.target === this.root) this.clickInMargin(event.clientX, event.clientY)
  }

  private onMouseDown(event: MouseEvent) {
    this.mouseDown = true
    this.goalX = null
    const target = event.target as Element
    if (target.closest('.table-tools')) {
      // The tools act on the selection: it must stay where it is.
      event.preventDefault()
      return
    }
    const image = target.closest<HTMLElement>('[data-inline="image"], [data-inline="html"].img')
    const imageLeaf = leafElementAt(image)
    if (image && imageLeaf?.dataset.node && !inChrome(target)) {
      // A click on a rendered image selects it and shows its source (NAV-11, IMG-2). The source
      // span is its own editing host: it takes focus so keys reach it.
      event.preventDefault()
      const end = offsetIn(imageLeaf, image, image.childNodes.length)
      const id = imageLeaf.dataset.node
      this.place(id, end)
      const source = image.querySelector<HTMLElement>('.syntax.content[contenteditable="true"]')
      if (source) {
        // Revealed first: a hidden span cannot take focus.
        source.focus({ preventScroll: true })
        this.restore(at(id, end))
      }
      return
    }
    const atom = target.closest<HTMLElement>('.atom[data-node]')
    if (atom?.dataset.node) {
      // A rule is selected as a whole (NAV-15).
      event.preventDefault()
      this.selectAtom(atom.dataset.node)
      return
    }
    // Islands open up while the button is down, so a drag can select across them (§7.6).
    this.setIslandsEditable(true)
  }

  private setIslandsEditable(editable: boolean) {
    for (const island of islandsOf(this.root)) island.contentEditable = editable ? 'true' : 'false'
  }

  /** A click beside a block lands at its start or end (NAV-14); below the last block, see NAV-13. */
  private clickInMargin(x: number, y: number) {
    for (const block of this.root.children) {
      const box = block.getBoundingClientRect()
      if (y < box.top || y > box.bottom) continue
      const id = (block as HTMLElement).dataset.node
      const node = id ? this.doc.getNode(id) : undefined
      if (!node) return
      if (node.type === 'hr') {
        this.selectAtom(node.id)
        return
      }
      const leaf = x < box.left ? node.firstLeaf() : node.lastLeaf()
      this.place(leaf.id, x < box.left ? 0 : leaf.text.length)
      return
    }
    this.clickBelow(y)
  }

  /** A click below the last block: its empty paragraph, or a temporary one that goes if left empty (NAV-13). */
  private clickBelow(y: number) {
    this.flushAll()
    const last = this.doc.root.lastChild
    const element = last ? elementFor(this.root, last.id) : null
    if (!last || !element || y <= element.getBoundingClientRect().bottom) return
    this.landBelow(last)
  }

  /** The caret goes to the last block's empty paragraph, or to a temporary one added after it (NAV-5, NAV-13). */
  private landBelow(last: Node) {
    if (last.type === 'paragraph' && last.text.length === 0) {
      this.place(last.id, 0)
      return
    }
    const paragraph = this.doc.createNode('paragraph')
    this.doc.root.appendChild(paragraph)
    syncRange(this.root, this.doc, { before: last.id, after: null }, this.context)
    this.temporary = paragraph.id
    this.place(paragraph.id, 0)
  }

  /** A task checkbox toggled: the item's state changes, the caret stays where it was (LST-3). */
  private onChange(event: Event) {
    const input = event.target
    if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return
    const item = input.closest<HTMLElement>('li[data-node]')
    const node = item?.dataset.node ? this.doc.getNode(item.dataset.node) : undefined
    if (!item || !node) return
    const checked = input.checked
    const cursor = bookmarkFromSelection(this.root)
    this.transact(anchorsAround(node), cursor, () => {
      node.checked = checked
      return { caret: cursor }
    })
  }

  private onSelectionChange() {
    if (this.destroyed) return
    if (this.typing?.lastCaret && !this.composing) {
      const now = bookmarkFromSelection(this.root)
      const last = this.typing.lastCaret
      if (!now || now.blockId !== last.blockId || now.start !== last.start || now.end !== last.end) this.closeTyping()
    }
    if (this.atom && !this.atomStillSelected()) this.clearAtom()
    this.refocus(selectedLeaf(this.root)?.dataset.node ?? null)
    this.scheduleExpand()
  }

  // --- navigation (§7.5) -----------------------------------------------------------------------

  /** Left or Right: one source character, hidden syntax included; across a block edge, the neighbor leaf. */
  private moveHorizontal(direction: -1 | 1, extend: boolean): boolean {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) return false
    if (!extend && !selection.isCollapsed) return false
    const focusNode = selection.focusNode
    if (!focusNode) return false
    const leaf = leafElementAt(focusNode)
    if (!leaf?.dataset.node || !this.root.contains(leaf)) return false
    const offset = offsetIn(leaf, focusNode, selection.focusOffset)
    const length = textOf(leaf).length
    let target: HTMLElement = leaf
    let at = offset + direction
    if ((direction === 1 && offset >= length) || (direction === -1 && offset <= 0)) {
      const node = this.doc.getNode(leaf.dataset.node)
      const neighbor = this.reachable(direction === 1 ? node?.nextLeaf() : node?.previousLeaf())
      if (!neighbor) {
        if (direction === -1) this.hooks.onReachTop?.()
        return true
      }
      if (neighbor.type === 'hr') {
        if (!extend) this.selectAtom(neighbor.id)
        return true
      }
      const element = elementFor(this.root, neighbor.id)
      if (!element) return true
      target = element
      at = direction === 1 ? 0 : textOf(element).length
    }
    const [node, nodeOffset] = positionAt(target, at)
    this.moveSelection(selection, node, nodeOffset, extend)
    return true
  }

  /** Up or Down: the browser moves within a block; from its first or last line, the neighbor block at the same x (NAV-4). */
  private moveVertical(direction: -1 | 1, extend: boolean): boolean {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.focusNode) return false
    const leaf = leafElementAt(selection.focusNode)
    if (!leaf?.dataset.node || !this.root.contains(leaf)) return false
    const caret = caretRect(selection.focusNode, selection.focusOffset, leaf)
    if (this.goalX === null) this.goalX = caret.left
    if (!onEdgeLine(caret, leaf, direction)) return false
    const node = this.doc.getNode(leaf.dataset.node)
    if (!node) return false
    const target = this.verticalTarget(node, direction)
    if (!target) {
      // Up at the very start of the document goes on to the panel; elsewhere on the first line the caret stays (NAV-4).
      if (direction === -1 && !extend && offsetIn(leaf, selection.focusNode, selection.focusOffset) === 0) {
        this.hooks.onReachTop?.()
      }
      if (direction === 1 && !extend) {
        const last = this.doc.root.lastChild
        if (last) this.landBelow(last)
      }
      return true
    }
    if (target.type === 'hr') {
      if (!extend) this.selectAtom(target.id)
      return true
    }
    const element = elementFor(this.root, target.id)
    if (!element) return true
    const box = element.getBoundingClientRect()
    const y = direction === 1 ? box.top + 2 : box.bottom - 2
    const [positionNode, positionOffset] = positionFromPoint(element, this.goalX, y, direction === 1 ? 'start' : 'end')
    this.moveSelection(selection, positionNode, positionOffset, extend)
    return true
  }

  /** The leaf Up or Down lands in: the cell in the next row for a cell, the neighbor leaf otherwise, entering a table at its edge row. */
  private verticalTarget(node: Node, direction: -1 | 1): Node | null {
    const row = node.parent?.type === 'table_row' ? node.parent : null
    if (row) {
      const nextRow = direction === 1 ? row.after : row.before
      if (nextRow) return nextRow.children[Math.min(node.index, nextRow.childCount - 1)] ?? null
      const table = row.parent!
      return this.reachable(direction === 1 ? table.nextLeaf() : table.previousLeaf())
    }
    const neighbor = this.reachable(direction === 1 ? node.nextLeaf() : node.previousLeaf())
    if (neighbor?.type === 'table_cell' && neighbor.parent?.parent) {
      const table = neighbor.parent.parent
      const edgeRow = direction === 1 ? table.firstChild : table.lastChild
      const rowElement = edgeRow ? elementFor(this.root, edgeRow.id) : null
      const cell = rowElement ? cellUnder(rowElement, this.goalX ?? 0, direction === 1 ? 'first' : 'last') : null
      return cell?.dataset.node ? (this.doc.getNode(cell.dataset.node) ?? neighbor) : neighbor
    }
    return neighbor
  }

  private moveSelection(selection: Selection, node: globalThis.Node, offset: number, extend: boolean) {
    if (extend) selection.extend(node, offset)
    else selection.collapse(node, offset)
    const leaf = leafElementAt(node)
    if (leaf?.dataset.node) this.refocus(leaf.dataset.node)
    this.expandAtSelection()
  }

  /** Select All: a fence's code, a cell's text or the front matter first; the whole document second (NAV-21). */
  private selectAll(): boolean {
    const selection = document.getSelection()
    if (!selection) return false
    const leaf = selectedLeaf(this.root)
    const node = leaf?.dataset.node ? this.doc.getNode(leaf.dataset.node) : undefined
    const scoped =
      leaf && node && (node.isVerbatim() || node.type === 'table_cell') && !this.wholeLeafSelected(selection, leaf)
    // From the first text position to the last: a range at the root's child boundaries reads as empty.
    const range = rangeOverText(scoped ? leaf : this.root)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }

  private wholeLeafSelected(selection: Selection, leaf: HTMLElement): boolean {
    if (selection.isCollapsed || selection.rangeCount === 0) return false
    const range = selection.getRangeAt(0)
    if (leafElementAt(range.startContainer) !== leaf || leafElementAt(range.endContainer) !== leaf) return false
    const length = textOf(leaf).length
    return (
      offsetIn(leaf, range.startContainer, range.startOffset) === 0 &&
      offsetIn(leaf, range.endContainer, range.endOffset) >= length
    )
  }

  // --- atoms: a rule selected as a whole ---------------------------------------------------------

  private selectAtom(id: string) {
    const element = elementFor(this.root, id)
    if (!element) return
    this.flushAll()
    this.clearAtom()
    this.refocus(null)
    this.atom = id
    element.classList.add('selected')
    const range = document.createRange()
    range.selectNode(element)
    selectRange(range)
    this.expandAtSelection()
  }

  private clearAtom() {
    if (!this.atom) return
    elementFor(this.root, this.atom)?.classList.remove('selected')
    this.atom = null
  }

  private atomStillSelected(): boolean {
    const selection = document.getSelection()
    const element = this.atom ? elementFor(this.root, this.atom) : null
    if (!selection || selection.rangeCount === 0 || !element) return false
    const range = selection.getRangeAt(0)
    return (
      range.startContainer === element.parentNode &&
      range.endContainer === element.parentNode &&
      range.endOffset - range.startOffset === 1 &&
      element.parentNode?.childNodes[range.startOffset] === element
    )
  }

  /** Keys while a rule is selected: arrows leave it, Backspace and Delete remove it (DEL-17), Enter does nothing (ENT-22). */
  private onAtomKey(event: KeyboardEvent): boolean {
    const id = this.atom
    const node = id ? this.doc.getNode(id) : undefined
    if (!id || !node) return false
    const key = event.key
    if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'ArrowRight' || key === 'ArrowDown') {
      event.preventDefault()
      const forward = key === 'ArrowRight' || key === 'ArrowDown'
      const neighbor = this.reachable(forward ? node.nextLeaf() : node.previousLeaf())
      this.clearAtom()
      if (neighbor?.type === 'hr') this.selectAtom(neighbor.id)
      else if (neighbor) this.place(neighbor.id, forward ? 0 : neighbor.text.length)
      else if (forward) this.landBelow(node)
      else this.selectAtom(id)
      return true
    }
    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault()
      const neighbor = this.reachable(
        key === 'Backspace' ? (node.previousLeaf() ?? node.nextLeaf()) : (node.nextLeaf() ?? node.previousLeaf()),
      )
      this.clearAtom()
      const anchors = anchorsAround(node)
      this.transact(anchors, null, () => {
        this.doc.removeWithEmptyAncestors(node)
        this.ensureBlock()
        return {
          caret:
            neighbor && neighbor.type !== 'hr' ? at(neighbor.id, key === 'Backspace' ? neighbor.text.length : 0) : null,
        }
      })
      if (!neighbor) {
        const first = this.doc.root.firstChild
        if (first) this.place(first.firstLeaf().id, 0)
      }
      return true
    }
    if (key === 'Enter' || key.length === 1) {
      event.preventDefault()
      return true
    }
    return false
  }

  /** The focused block changed: the one left is stored and committed (§6.2 step 0). */
  private refocus(id: string | null) {
    if (id === this.focusedId) return
    const previous = this.focusedId
    this.focusedId = id
    this.armed = null
    if (this.typing && this.typing.id !== id) this.closeTyping()
    if (this.busy) this.hostBlock(previous, id)
    if (previous) this.leaveBlock(previous)
  }

  /** Busy mode: the block the caret is in becomes the editing host, the one it left stops being one. */
  private hostBlock(previous: string | null, id: string | null) {
    const before = previous ? elementFor(this.root, previous) : null
    if (before && before.getAttribute('contenteditable') === 'true' && before.dataset.type !== 'table_cell') {
      before.removeAttribute('contenteditable')
    }
    const leaf = id ? elementFor(this.root, id) : null
    if (leaf && leaf.getAttribute('contenteditable') !== 'true') {
      leaf.contentEditable = 'true'
      leaf.focus({ preventScroll: true })
    }
  }

  /** Measures the document and switches busy mode on or off (§15). */
  private applyBusyMode() {
    const leaves = this.root.querySelectorAll('.end-block').length
    const busy = leaves > BUSY_LEAVES || this.root.innerHTML.length > BUSY_HTML_LENGTH
    if (busy === this.busy) return
    this.busy = busy
    this.root.contentEditable = busy ? 'false' : 'true'
    if (!busy) {
      for (const leaf of this.root.querySelectorAll<HTMLElement>('.end-block[contenteditable="true"]')) {
        if (leaf.dataset.type !== 'table_cell') leaf.removeAttribute('contenteditable')
      }
    } else if (this.focusedId) this.hostBlock(null, this.focusedId)
  }

  /** Refocus (§6.4): the block the caret left is stored, then its type committed. */
  private leaveBlock(id: string) {
    const node = this.doc.getNode(id)
    if (!node || !elementFor(this.root, id)) return
    this.queue.delete(id)
    this.repaintBlock(id)
    if (!this.doc.getNode(id)) return
    if (id === this.temporary) {
      this.temporary = null
      if (node.type === 'paragraph' && node.text.length === 0) {
        const anchors = anchorsAround(node)
        this.doc.removeNode(node)
        syncRange(this.root, this.doc, anchors, this.context)
        return
      }
    }
    this.transact(anchorsAround(node), null, () => {
      const transition = node.isVerbatim() ? storeVerbatim(this.doc, node) : commitBlock(this.doc, node, null)
      return transition ? { caret: null } : null
    })
  }

  // --- structure: Enter, Backspace, Delete, selections, Tab (§8) --------------------------------

  /** The model's text for a block is the DOM's before any structural step. */
  private flush(id: string) {
    this.queue.delete(id)
    this.repaintBlock(id)
  }

  /** Every pending block: a structural re-render draws from the model, which must be current. */
  private flushAll() {
    for (const id of Array.from(this.queue)) this.flush(id)
  }

  /** The leaf under the caret with its model node, after flushing everything pending. */
  private current(): { node: Node; bookmark: Bookmark } | null {
    const leaf = selectedLeaf(this.root)
    if (!leaf?.dataset.node) return null
    this.flushAll()
    this.flush(leaf.dataset.node)
    const bookmark = bookmarkFromSelection(this.root)
    const node = bookmark ? this.doc.getNode(bookmark.blockId) : undefined
    return node && bookmark ? { node, bookmark } : null
  }

  /** Puts the caret at an offset in a leaf and makes that leaf the focused block. */
  private place(id: string, offset: number, end = offset) {
    // The panel's front matter takes the caret through the panel, not the document.
    const node = this.doc.getNode(id)
    if (node && !this.reachable(node)) {
      this.hooks.onReachTop?.()
      return
    }
    this.focusedId = id
    this.armed = null
    this.restore({ blockId: id, start: offset, end })
    this.expandAtSelection()
  }

  private rerenderLeaf(node: Node) {
    const element = elementFor(this.root, node.id)
    if (!element) return
    if (node.isInline()) {
      element.innerHTML = renderInlineContent(node, this.context)
      const looksLike = looksLikeAttr(node).replace(/^ data-looks-like="|"$/g, '')
      if (looksLike.length > 0) element.dataset.looksLike = looksLike
      else delete element.dataset.looksLike
    } else {
      element.innerHTML = node.type === 'fence' ? renderFenceInner(node) : renderVerbatimContent(node.text)
    }
  }

  /**
   * A structural step (§9.2): the run of typing closes, the model changes inside `mutate`, the
   * top-level blocks between the anchors re-render, the caret lands, and one command holding
   * both sides is recorded. False when nothing changed.
   */
  private transact(anchors: Anchors, cursorBefore: Bookmark | null, mutate: () => Outcome): boolean {
    const before = this.snapshot(anchors)
    const outcome = mutate()
    if (!outcome) return false
    // The run of typing so far is its own step, recorded before this one; the DOM still reads as it did.
    this.closeTyping()
    const after = this.snapshot(anchors)
    syncRange(this.root, this.doc, anchors, this.context)
    if (outcome.caret) this.place(outcome.caret.blockId, outcome.caret.start, outcome.caret.end)
    this.history.push({ kind: 'range', anchors, before, after, cursorBefore, cursorAfter: outcome.caret })
    this.markDirty()
    this.noteFrontmatter()
    return true
  }

  // --- the front matter, when the properties panel owns it ---------------------------------------

  /** The front matter node, when the document has one — always the first block. */
  private frontmatterNode(): Node | null {
    const first = this.doc.root.firstChild
    return first?.type === 'frontmatter' ? first : null
  }

  frontmatterText(): string | null {
    this.flushAll()
    return this.frontmatterNode()?.text ?? null
  }

  /** Tells the panel when the front matter changed under it — an undo, a reload, `---` typed. */
  private noteFrontmatter() {
    const text = this.frontmatterNode()?.text ?? null
    if (text === this.lastFrontmatter) return
    this.lastFrontmatter = text
    this.hooks.onFrontmatter?.(text)
  }

  /** A leaf the caret may go to: the front matter is off limits while the panel shows it. */
  private reachable(leaf: Node | null | undefined): Node | null {
    if (!leaf) return null
    return leaf.type === 'frontmatter' && this.state.hideFrontmatter ? null : leaf
  }

  /** The caret at the start of the first block that is not the panel's front matter. */
  focusStart() {
    this.flushAll()
    let leaf: Node | null = this.doc.root.firstLeaf()
    while (leaf && !this.reachable(leaf)) leaf = leaf.nextLeaf()
    if (!leaf) return
    this.root.focus({ preventScroll: true })
    this.place(leaf.id, 0)
  }

  /** Sets the front matter body from the panel: one undo step, the block created or removed as needed. */
  setFrontmatter(text: string | null) {
    this.flushAll()
    const node = this.frontmatterNode()
    if ((node?.text ?? null) === text) return
    const first = this.doc.root.firstChild
    const anchors: Anchors = { before: null, after: (node ? node.after?.id : first?.id) ?? null }
    this.lastFrontmatter = text
    this.transact(anchors, null, () => {
      if (text === null) {
        if (node) this.doc.removeNode(node)
        this.ensureBlock()
        return { caret: null }
      }
      if (node) {
        node.text = text
        node.empty = text.length === 0
        return { caret: null }
      }
      const created = this.doc.createNode('frontmatter', { text, pattern: '---', patternEnd: '---' })
      created.ahead = 0
      created.empty = text.length === 0
      if (first && (first.ahead ?? 0) === 0) first.ahead = 1
      this.doc.root.prependChild(created)
      return { caret: null }
    })
  }

  private enter(shift: boolean, modifier: boolean) {
    const current = this.current()
    if (!current) return
    const { node, bookmark } = current
    const caret = bookmark.start
    if (node.type === 'table_cell') {
      this.enterInCell(node, shift, modifier)
      return
    }
    if (node.isVerbatim()) {
      const atEnd = caret === node.text.length
      const emptyLastLine = atEnd && node.text.endsWith('\n')
      // Shift+Enter always stays inside (ENT-7); Enter leaves on an empty last line or with a modifier at the end.
      if (node.type !== 'definition' && (shift || (!emptyLastLine && !(modifier && atEnd)))) {
        // A newline keeps the current line's indentation (FEN-2).
        const lineStart = node.text.lastIndexOf('\n', caret - 1) + 1
        const indent = /^[ \t]*/.exec(node.text.slice(lineStart, caret))?.[0] ?? ''
        this.insertText(`\n${indent}`)
        return
      }
      this.transact(anchorsAround(node), bookmark, () => {
        if (emptyLastLine) node.text = node.text.slice(0, -1)
        const following = node.after
        if (node.type === 'definition' && node.text.length === 0) {
          node.clearAttrs()
          node.type = 'paragraph'
          return { caret: at(node.id, 0) }
        }
        if (following?.type === 'paragraph' && following.text.length === 0) {
          // The empty paragraph the block was created with is the way out.
          return { caret: at(following.id, 0) }
        }
        const after = this.doc.createNode('paragraph')
        node.addAfter(after)
        return { caret: at(after.id, 0) }
      })
      return
    }
    if (shift && node.type === 'paragraph') {
      // A soft break inside the block (ENT-7).
      this.insertText('\n')
      return
    }
    if (modifier && node.parent?.type === 'list_item') {
      // A new paragraph inside the same item (ENT-8).
      this.transact(anchorsAround(node), bookmark, () => {
        const after = this.doc.createNode('paragraph')
        node.addAfter(after)
        return { caret: at(after.id, 0) }
      })
      return
    }
    this.transact(anchorsAround(node), bookmark, () => {
      const result = splitBlock(this.doc, node, caret, this.context)
      return { caret: at(result.leaf.id, result.offset) }
    })
  }

  private backspaceAtStart() {
    const current = this.current()
    if (!current) return
    const previous = current.node.previousLeaf()
    // The panel's front matter is not a block to join into.
    if (previous && !this.reachable(previous)) return
    const anchors = anchorsAround(...(previous ? [previous, current.node] : [current.node]))
    this.transact(anchors, current.bookmark, () => {
      const landing = backspaceAtStart(this.doc, current.node)
      return landing ? { caret: at(landing.leaf.id, landing.offset) } : null
    })
  }

  private deleteAtEnd() {
    const current = this.current()
    if (!current) return
    const next = current.node.nextLeaf()
    const anchors = anchorsAround(...(next ? [current.node, next] : [current.node]))
    this.transact(anchors, current.bookmark, () => {
      const landing = deleteAtEnd(this.doc, current.node)
      return landing ? { caret: at(landing.leaf.id, landing.offset) } : null
    })
  }

  /** Deletes the selection: within one block, widened to the markers it touches (DEL-21); across blocks, by merging (DEL-22). */
  private deleteSelection() {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.getRangeAt(0).collapsed) return
    const range = selection.getRangeAt(0)
    const startLeaf = leafElementAt(range.startContainer)
    const endLeaf = leafElementAt(range.endContainer)
    if (!startLeaf?.dataset.node || !endLeaf?.dataset.node) return
    if (!this.root.contains(startLeaf) || !this.root.contains(endLeaf)) return
    const startOffset = offsetIn(startLeaf, range.startContainer, range.startOffset)
    const endOffset = offsetIn(endLeaf, range.endContainer, range.endOffset)
    const startId = startLeaf.dataset.node
    const endId = endLeaf.dataset.node
    this.flushAll()
    this.flush(startId)
    if (endId !== startId) this.flush(endId)
    const start = this.doc.getNode(startId)
    const end = this.doc.getNode(endId)
    if (!start || !end) return
    const cursorBefore: Bookmark = {
      blockId: startId,
      start: startOffset,
      end: startId === endId ? endOffset : startOffset,
    }
    this.transact(anchorsAround(start, end), cursorBefore, () => {
      const landing = this.removeSelectionModel(start, startOffset, end, endOffset)
      return landing ? { caret: at(landing.leaf.id, landing.offset) } : null
    })
  }

  /** The model side of deleting a selection: within one block widened to its markers (DEL-21), across blocks by merging (DEL-22). */
  private removeSelectionModel(
    start: Node,
    startOffset: number,
    end: Node,
    endOffset: number,
  ): { leaf: Node; offset: number } | null {
    if (start === end) {
      const [from, to] = start.isInline()
        ? widenSelection(start.text, startOffset, endOffset, this.context)
        : [startOffset, endOffset]
      start.text = start.text.slice(0, from) + start.text.slice(to)
      return { leaf: start, offset: from }
    }
    return deleteAcross(this.doc, start, startOffset, end, endOffset)
  }

  private tab(shift: boolean) {
    const selected = this.selectedLeaves()
    if (selected && selected.leaves.length > 1 && this.tabItems(selected.leaves, shift, selected.cursor)) return
    const current = this.current()
    if (!current) return
    const { node, bookmark } = current
    if (node.type === 'table_cell') {
      this.tabInCell(node, shift)
      return
    }
    if (shift && node.isVerbatim()) {
      // Shift+Tab in code takes one level of indentation off the current line (TAB-7).
      const lineStart = node.text.lastIndexOf('\n', bookmark.start - 1) + 1
      const leading = /^(\t| {1,4})/.exec(node.text.slice(lineStart))
      if (!leading) return
      this.transact(anchorsAround(node), bookmark, () => {
        node.text = node.text.slice(0, lineStart) + node.text.slice(lineStart + leading[0].length)
        return { caret: at(node.id, Math.max(lineStart, bookmark.start - leading[0].length)) }
      })
      return
    }
    const item = node.parent?.type === 'list_item' && node.parent.firstChild === node ? node.parent : null
    if (item) {
      this.transact(anchorsAround(item), bookmark, () => {
        const changed = shift ? outdentItem(this.doc, item) : indentItem(this.doc, item)
        return changed ? { caret: at(node.id, bookmark.start) } : null
      })
      return
    }
    if (shift) {
      // TAB-8: out of a quote, or the line's leading whitespace, or nothing.
      if (node.type === 'paragraph' && node.parent?.type === 'blockquote') {
        this.transact(anchorsAround(node), bookmark, () => {
          unnest(this.doc, node)
          return { caret: at(node.id, bookmark.start) }
        })
        return
      }
      const leading = /^[ \t]+/.exec(node.text)
      if (leading) {
        this.transact(anchorsAround(node), bookmark, () => {
          node.text = node.text.slice(leading[0].length)
          return { caret: at(node.id, Math.max(0, bookmark.start - leading[0].length)) }
        })
      }
      return
    }
    this.insertText('\t')
  }

  // --- undo and redo (§9) ----------------------------------------------------------------------

  /** Opens or extends the run of typing a keystroke belongs to (§9.3), before the DOM changes. */
  private beginTyping(id: string, kind: string) {
    const now = Date.now()
    const run = this.typing
    if (run && (run.id !== id || run.kind !== kind || now - run.at > TYPING_WINDOW_MS)) this.closeTyping()
    if (this.typing) {
      this.typing.at = now
      return
    }
    const element = elementFor(this.root, id)
    this.typing = {
      id,
      kind,
      before: { text: element ? textOf(element) : '', cursor: bookmarkFromSelection(this.root) },
      at: now,
      lastCaret: null,
    }
  }

  /** The run's caret after an edit; a later caret elsewhere ends the run (UND-1). */
  private noteTypingCaret() {
    if (this.typing) this.typing.lastCaret = bookmarkFromSelection(this.root)
  }

  /** Ends the run of typing: what the block reads now is the step's other side. */
  private closeTyping() {
    const run = this.typing
    if (!run) return
    this.typing = null
    // The element still reads the typed text even when a structural step has just replaced the node.
    const element = elementFor(this.root, run.id)
    if (!element) return
    const text = textOf(element)
    if (text === run.before.text) return
    const selection = bookmarkFromSelection(this.root)
    const cursor = selection?.blockId === run.id ? selection : at(run.id, text.length)
    this.history.push({ kind: 'text', id: run.id, before: run.before, after: { text, cursor } })
  }

  private undo() {
    if (this.composing) return
    this.closeTyping()
    const command = this.history.undo()
    if (!command) return
    this.applyCommand(command, 'before')
  }

  private redo() {
    if (this.composing) return
    this.closeTyping()
    const command = this.history.redo()
    if (!command) return
    this.applyCommand(command, 'after')
  }

  private applyCommand(command: Command, side: 'before' | 'after') {
    this.applyCommandInner(command, side)
    this.noteFrontmatter()
  }

  private applyCommandInner(command: Command, side: 'before' | 'after') {
    this.flushAll()
    if (command.kind === 'text') {
      const node = this.doc.getNode(command.id)
      if (!node) return
      const target = command[side]
      node.text = target.text
      this.queue.delete(node.id)
      this.rerenderLeaf(node)
      const cursor = target.cursor ?? at(node.id, target.text.length)
      this.place(cursor.blockId, cursor.start, cursor.end)
    } else {
      this.applyRange(command.anchors, command[side], side === 'before' ? command.cursorBefore : command.cursorAfter)
    }
    this.markDirty()
  }

  /** The top-level blocks between two anchors, as they are now. */
  private nodesBetween(anchors: Anchors): Node[] {
    const nodes: Node[] = []
    const first = anchors.before ? (this.doc.getNode(anchors.before)?.after ?? null) : this.doc.root.firstChild
    for (let node = first; node && node.id !== anchors.after; node = node.after) nodes.push(node)
    return nodes
  }

  private snapshot(anchors: Anchors): NodeJson[] {
    return this.nodesBetween(anchors).map((node) => node.toJSON())
  }

  /** Replaces the blocks between two anchors with ones rebuilt from JSON, keeping their ids. */
  private applyRange(anchors: Anchors, json: NodeJson[], cursor: Bookmark | null) {
    for (const node of this.nodesBetween(anchors)) this.doc.removeNode(node)
    const beforeNode = anchors.before ? (this.doc.getNode(anchors.before) ?? null) : null
    const afterNode = anchors.after ? (this.doc.getNode(anchors.after) ?? null) : null
    let anchor = beforeNode
    for (const entry of json) {
      const node = this.doc.fromJSON(entry)
      if (anchor) anchor.addAfter(node)
      else if (afterNode) afterNode.addBefore(node)
      else this.doc.root.appendChild(node)
      anchor = node
    }
    this.ensureBlock()
    syncRange(this.root, this.doc, anchors, this.context)
    if (cursor && this.doc.getNode(cursor.blockId)) this.place(cursor.blockId, cursor.start, cursor.end)
    else this.expandAtSelection()
  }

  // --- tables (§12.6) --------------------------------------------------------------------------

  /** Tab over a selection spanning items indents or outdents all of them as one step (TAB-4). */
  private tabItems(leaves: Node[], shift: boolean, cursor: Bookmark): boolean {
    const items: Node[] = []
    for (const leaf of leaves) {
      const item = leaf.parent?.type === 'list_item' && leaf.parent.firstChild === leaf ? leaf.parent : null
      if (item && !items.includes(item)) items.push(item)
    }
    if (items.length < 2) return false
    const first = items[0]!
    const last = items[items.length - 1]!
    return this.transact(anchorsAround(first, last), cursor, () => {
      let changed = false
      for (const item of items) if (shift ? outdentItem(this.doc, item) : indentItem(this.doc, item)) changed = true
      return changed ? { caret: cursor } : null
    })
  }

  /** Enter in a cell: the cell below, its content selected; from the last row, the block after (ENT-17). Shift+Enter is a `<br>`; Cmd+Enter a new row (ENT-8). */
  private enterInCell(cell: Node, shift: boolean, modifier: boolean) {
    const position = cellPosition(cell)
    if (!position) return
    if (shift) {
      this.insertText('<br>')
      return
    }
    if (modifier) {
      this.transact(anchorsAround(position.table), bookmarkFromSelection(this.root), () => {
        const row = insertRow(this.doc, position.table, position.rowIndex + 1)
        const target = row.children[position.colIndex] ?? row.firstChild!
        return { caret: at(target.id, 0) }
      })
      return
    }
    const below = cellBelow(cell)
    if (below) {
      this.place(below.id, 0, below.text.length)
      return
    }
    const after = position.table.nextLeaf()
    if (after && after.type !== 'hr') this.place(after.id, 0)
    else this.landBelow(position.table)
  }

  /** Tab in a cell: the next cell, selected; a new row after the last cell. Shift+Tab: the previous cell (TAB-5). */
  private tabInCell(cell: Node, shift: boolean) {
    const target = shift ? previousCell(cell) : nextCell(cell)
    if (target) {
      this.place(target.id, 0, target.text.length)
      return
    }
    if (shift) return
    const position = cellPosition(cell)
    if (!position) return
    this.transact(anchorsAround(position.table), bookmarkFromSelection(this.root), () => {
      const row = insertRow(this.doc, position.table, position.table.childCount)
      return { caret: at(row.firstChild!.id, 0) }
    })
  }

  /** Cmd+Shift+Backspace in a row deletes it (DEL-20). */
  private deleteCurrentRow(): boolean {
    const current = this.current()
    if (!current || current.node.type !== 'table_cell') return false
    const position = cellPosition(current.node)
    if (!position) return false
    return this.tableTransaction(position, () => deleteRow(this.doc, position.table, position.rowIndex) !== null)
  }

  /** Runs a table change and lands the caret in the same logical cell, or after a table that went. */
  private tableTransaction(position: { table: Node; rowIndex: number; colIndex: number }, run: () => boolean): boolean {
    const { table } = position
    const neighbor = table.nextLeaf() ?? table.previousLeaf()
    return this.transact(anchorsAround(table), bookmarkFromSelection(this.root), () => {
      if (!run()) return null
      if (!this.doc.getNode(table.id)) {
        this.ensureBlock()
        const landing = neighbor && this.doc.getNode(neighbor.id) ? neighbor : this.doc.root.firstLeaf()
        return { caret: landing.type === 'hr' ? null : at(landing.id, 0) }
      }
      const cell = cellAt(table, position.rowIndex, position.colIndex)
      return { caret: cell ? at(cell.id, 0) : null }
    })
  }

  /** A button of the table tools, acting on the cell the caret is in (TBL-2, TBL-3, TBL-6). */
  private tableAction(action: string) {
    const current = this.current()
    if (!current || current.node.type !== 'table_cell') return
    const position = cellPosition(current.node)
    if (!position) return
    const { table, rowIndex, colIndex } = position
    const columns = columnCount(table)
    const rows = table.childCount
    const run: Record<string, () => boolean> = {
      'row-above': () => (insertRow(this.doc, table, Math.max(1, rowIndex)), true),
      'row-below': () => (insertRow(this.doc, table, rowIndex + 1), true),
      'row-delete': () => deleteRow(this.doc, table, rowIndex) !== null,
      'row-up': () => moveRow(table, rowIndex, rowIndex - 1),
      'row-down': () => moveRow(table, rowIndex, rowIndex + 1),
      'col-left': () => (insertColumn(this.doc, table, colIndex), true),
      'col-right': () => (insertColumn(this.doc, table, colIndex + 1), true),
      'col-delete': () => deleteColumn(this.doc, table, colIndex) !== null,
      'col-back': () => moveColumn(table, colIndex, colIndex - 1),
      'col-forward': () => moveColumn(table, colIndex, colIndex + 1),
      'align-left': () => (setAlignment(table, colIndex, 'left'), true),
      'align-center': () => (setAlignment(table, colIndex, 'center'), true),
      'align-right': () => (setAlignment(table, colIndex, 'right'), true),
      'align-none': () => (setAlignment(table, colIndex, null), true),
      'table-delete': () => (this.doc.removeWithEmptyAncestors(table), true),
    }
    const step = run[action]
    if (!step) return
    const landing = {
      table,
      rowIndex:
        action === 'row-up'
          ? rowIndex - 1
          : action === 'row-down'
            ? rowIndex + 1
            : action === 'row-above' && rowIndex > 0
              ? rowIndex + 1
              : Math.min(rowIndex, rows - 1),
      colIndex:
        action === 'col-back'
          ? colIndex - 1
          : action === 'col-forward'
            ? colIndex + 1
            : action === 'col-left'
              ? colIndex + 1
              : Math.min(colIndex, columns - 1),
    }
    this.tableTransaction(landing, step)
  }

  /** The focused table wears its tools; any other table sheds them. */
  private ensureTableTools(leaf: HTMLElement | null) {
    const figure = leaf?.closest<HTMLElement>('figure[data-type="table"]') ?? null
    const existing = this.root.querySelector<HTMLElement>('.table-tools')
    if (existing && existing.parentElement !== figure) existing.remove()
    if (!figure || figure.querySelector('.table-tools')) return
    const tools = document.createElement('div')
    tools.className = 'table-tools'
    tools.setAttribute('data-chrome', '')
    tools.contentEditable = 'false'
    const group = (label: string, buttons: Array<[string, string, string]>) =>
      `<span>${label}${buttons.map(([action, text, title]) => `<button type="button" data-table-action="${action}" title="${title}">${text}</button>`).join('')}</span>`
    tools.innerHTML =
      group('Row', [
        ['row-above', '+↑', 'Add a row above'],
        ['row-below', '+↓', 'Add a row below'],
        ['row-up', '↑', 'Move the row up'],
        ['row-down', '↓', 'Move the row down'],
        ['row-delete', '✕', 'Delete the row'],
      ]) +
      group('Column', [
        ['col-left', '+←', 'Add a column before'],
        ['col-right', '+→', 'Add a column after'],
        ['col-back', '←', 'Move the column left'],
        ['col-forward', '→', 'Move the column right'],
        ['col-delete', '✕', 'Delete the column'],
      ]) +
      group('Align', [
        ['align-left', '⇤', 'Align the column left'],
        ['align-center', '↔', 'Center the column'],
        ['align-right', '⇥', 'Align the column right'],
        ['align-none', '·', 'No alignment'],
      ]) +
      group('', [['table-delete', 'Delete table', 'Delete the table']])
    figure.prepend(tools)
  }

  // --- the fence's language box (FEN-1) --------------------------------------------------------

  /**
   * The language box commits what it reads: into the node, one undo step, then the caret goes
   * into the code, or stays where focus went. `revert` puts the node's language back instead.
   */
  private commitLanguage(leaf: HTMLElement, then: 'code' | 'stay', revert = false) {
    const node = this.doc.getNode(leaf.dataset.node ?? '')
    const box = leaf.querySelector<HTMLElement>('.fence-lang > span')
    if (!node || node.type !== 'fence' || !box) return
    const lang = revert ? (node.lang ?? '') : (box.textContent ?? '').trim()
    if (lang !== (node.lang ?? '')) {
      this.transact(anchorsAround(node), null, () => {
        node.lang = lang
        return { caret: then === 'code' ? at(node.id, 0) : null }
      })
    } else if (revert) {
      box.textContent = lang
    }
    if (then === 'code') this.place(node.id, 0)
  }

  // --- clipboard (§13) -------------------------------------------------------------------------

  /** Copy and cut (CLP-1 … CLP-6): the selection's markdown as text, a clean HTML rendering, and our own marker. */
  private onCopy(event: ClipboardEvent, cut: boolean) {
    const data = event.clipboardData
    if (!data) return
    if (this.atom) {
      event.preventDefault()
      data.setData('text/plain', '---')
      data.setData('application/x-sky-markdown', '---')
      data.setData('text/html', '<hr>')
      return
    }
    const copied = this.selectionMarkdown()
    if (!copied) return
    event.preventDefault()
    data.setData('text/plain', copied.markdown)
    data.setData('text/html', copied.html)
    data.setData('application/x-sky-markdown', copied.markdown)
    if (cut) this.deleteSelection()
  }

  /** The markdown and HTML of the selection: the source spanned in one block, whole blocks and partial ends across blocks (CLP-2). */
  private selectionMarkdown(): { markdown: string; html: string } | null {
    const selected = this.selectedLeaves()
    if (!selected || (selected.leaves.length === 1 && selected.start === selected.end)) return null
    const { leaves, start, end } = selected
    if (leaves.length === 1) {
      const leaf = leaves[0]!
      const text = leaf.text.slice(start, end)
      const html = leaf.isInline()
        ? `<p>${renderInline(lexInline(text, this.context), 'export', this.context)}</p>`
        : `<pre><code>${escapeHtml(text)}</code></pre>`
      return { markdown: text, html }
    }
    const scratch = new MarkdownDocument()
    const tops: Node[] = []
    for (const leaf of leaves) {
      const top = leaf.topLevel()
      if (top && !tops.includes(top)) tops.push(top)
    }
    for (const top of tops) scratch.root.appendChild(scratch.fromJSON(top.toJSON()))
    const first = scratch.getNode(leaves[0]!.id)
    const last = scratch.getNode(leaves[leaves.length - 1]!.id)
    if (!first || !last) return null
    for (let leaf = first.previousLeaf(); leaf; leaf = first.previousLeaf()) scratch.removeWithEmptyAncestors(leaf)
    for (let leaf = last.nextLeaf(); leaf; leaf = last.nextLeaf()) scratch.removeWithEmptyAncestors(leaf)
    first.text = first.text.slice(start)
    last.text = last.text.slice(0, end)
    const context = contextFor(scratch, this.state.resolveImage)
    return { markdown: serializeDocument(scratch), html: renderExport(scratch.blocks, context) }
  }

  private onPaste(event: ClipboardEvent) {
    const data = event.clipboardData
    if (!data) return
    event.preventDefault()
    const plainOnly = this.plainPaste
    this.plainPaste = false
    if (this.attachFiles(data)) return
    this.pasteData(data, plainOnly)
  }

  /** A drop lands where the pointer is, then pastes (CLP-18). */
  private onDrop(event: DragEvent) {
    const data = event.dataTransfer
    if (!data) return
    event.preventDefault()
    const range = document.caretRangeFromPoint(event.clientX, event.clientY)
    const leaf = range ? leafElementAt(range.startContainer) : null
    if (range && leaf && this.root.contains(leaf)) {
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    if (this.attachFiles(data)) return
    this.pasteData(data, false)
  }

  /**
   * The flavors in order (CLP-7 … CLP-15): our own markdown, then foreign HTML converted — unless
   * its text already reads as markdown — then plain text.
   */
  private pasteData(data: DataTransfer, plainOnly: boolean) {
    const own = data.getData('application/x-sky-markdown')
    const html = data.getData('text/html')
    const text = data.getData('text/plain')
    let markdown = own
    if (!markdown && html && !plainOnly && !looksLikeMarkdown(text)) markdown = htmlToMarkdown(html)
    if (!markdown) markdown = text
    if (markdown.length > 0) this.pasteMarkdown(markdown)
  }

  /**
   * Files pasted or dropped (CLP-16) are copied beside the document through the attach API and
   * linked by name — an image as an image, anything else as a link. True when there were files.
   */
  private attachFiles(data: DataTransfer): boolean {
    const files = [...data.files]
    if (files.length === 0 || !this.state.attachPath) return false
    void this.storeFiles(files, this.state.attachPath)
    return true
  }

  private async storeFiles(files: File[], attachPath: string) {
    for (const file of files) {
      this.hooks.onStatus('saving', `Copying ${file.name}…`)
      try {
        const response = await fetch(`${attachPath}?name=${encodeURIComponent(file.name)}`, {
          method: 'PUT',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: file,
        })
        const body = (await response.json()) as { message?: string; file?: string; day?: string }
        if (!response.ok || !body.file) throw new Error(body.message ?? `Could not copy ${file.name}`)
        if (!this.root.isConnected) return
        const image = file.type.startsWith('image/')
        const link = `${image ? '!' : ''}[${escapeLinkText(body.file)}](${linkDestination(body.file)})`
        this.pasteMarkdown(link, { name: body.file, record: body.day !== undefined })
        this.hooks.onStatus(this.dirty ? 'dirty' : 'saved', this.dirty ? 'Unsaved' : 'Saved')
      } catch (error) {
        this.hooks.onStatus('error', error instanceof Error ? error.message : `Could not copy ${file.name}`)
      }
    }
  }

  /**
   * Pastes markdown at the caret, replacing any selection first, as one undo step (CLP-19). A
   * stored file's link goes in the same way — at the document's end when the selection has gone
   * meanwhile — and a day document records the file in its frontmatter in the same step.
   */
  private pasteMarkdown(markdown: string, attachment?: { name: string; record: boolean }) {
    const target = this.selectionTarget() ?? (attachment ? this.endTarget() : null)
    if (!target) return
    const { start, startOffset, end, endOffset, collapsed } = target
    const cursor: Bookmark = { blockId: start.id, start: startOffset, end: start === end ? endOffset : startOffset }
    const first = this.doc.root.firstChild
    const anchors = attachment?.record && first ? anchorsAround(first, start, end) : anchorsAround(start, end)
    this.transact(anchors, cursor, () => {
      let leaf = start
      let caret = startOffset
      if (!collapsed) {
        const landing = this.removeSelectionModel(start, startOffset, end, endOffset)
        if (!landing) return null
        leaf = landing.leaf
        caret = landing.offset
      }
      const literal = leaf.isInline() && insideCodeSpan(lexInline(leaf.text, this.context), caret)
      const landed = pasteText(this.doc, leaf, caret, markdown, literal)
      if (attachment?.record) this.recordAttachment(attachment.name)
      return { caret: at(landed.leaf.id, landed.offset) }
    })
  }

  /** The selection as model leaves and offsets, pending repaints applied; null when it is not in the editor. */
  private selectionTarget(): PasteTarget | null {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    const startLeaf = leafElementAt(range.startContainer)
    const endLeaf = leafElementAt(range.endContainer)
    if (!startLeaf?.dataset.node || !endLeaf?.dataset.node) return null
    this.flushAll()
    const start = this.doc.getNode(startLeaf.dataset.node)
    const end = this.doc.getNode(endLeaf.dataset.node)
    if (!start || !end) return null
    return {
      start,
      startOffset: offsetIn(startLeaf, range.startContainer, range.startOffset),
      end,
      endOffset: offsetIn(endLeaf, range.endContainer, range.endOffset),
      collapsed: range.collapsed,
    }
  }

  /** The end of the document's last leaf. */
  private endTarget(): PasteTarget | null {
    this.flushAll()
    const leaf = this.doc.root.lastLeaf()
    if (!leaf) return null
    return { start: leaf, startOffset: leaf.text.length, end: leaf, endOffset: leaf.text.length, collapsed: true }
  }

  /**
   * Records a stored file in the frontmatter's `attachments:` list, the way every capture does,
   * creating the frontmatter when the document has none.
   */
  private recordAttachment(name: string) {
    const entry = `  - { file: "${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" }`
    const first = this.doc.root.firstChild
    if (first?.type === 'frontmatter') {
      const lines = first.text.length > 0 ? first.text.split('\n') : []
      if (lines.some((line) => line.trim() === entry.trim())) return
      const key = lines.findIndex((line) => /^attachments:\s*(\[\s*\])?\s*$/.test(line))
      if (key === -1) lines.push('attachments:', entry)
      else {
        lines[key] = 'attachments:'
        let end = key + 1
        while (end < lines.length && /^\s*-\s/.test(lines[end]!)) end++
        lines.splice(end, 0, entry)
      }
      first.text = lines.join('\n')
      first.empty = false
      return
    }
    const node = this.doc.createNode('frontmatter', {
      text: `attachments:\n${entry}`,
      pattern: '---',
      patternEnd: '---',
    })
    node.ahead = 0
    if (first && (first.ahead ?? 0) === 0) first.ahead = 1
    this.doc.root.prependChild(node)
  }

  // --- formatting commands (§11.2) -------------------------------------------------------------

  /** Cmd/Ctrl shortcuts for styles and block types; true when one applied. */
  private formatShortcut(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase()
    const shift = event.shiftKey
    if (!shift) {
      switch (key) {
        case 'b':
          return this.toggleInline(STYLES.strong)
        case 'i':
          return this.toggleInline(STYLES.em)
        case 'u':
          return this.toggleInline(STYLES.underline)
        case 'e':
          return this.toggleInline(STYLES.code)
        case 'k':
          void this.toggleLink(STYLES.link)
          return true
        case '\\':
          return this.clearFormat()
      }
      if (/^[0-6]$/.test(key)) return this.heading(key === '0' ? null : Number(key))
      return false
    }
    switch (event.code) {
      case 'KeyX':
        return this.toggleInline(STYLES.strike)
      case 'KeyH':
        return this.toggleInline(STYLES.highlight)
      case 'KeyI':
        void this.toggleLink(STYLES.image)
        return true
      case 'KeyQ':
        return this.blockCommand((leaves) => toggleQuote(this.doc, leaves))
      case 'Digit8':
        return this.listCommand('ul')
      case 'Digit7':
        return this.listCommand('ol')
      case 'Digit9':
        return this.listCommand('task')
    }
    return false
  }

  /** The leaves a selection covers, in document order, with the offsets in the first and last. */
  private selectedLeaves(): { leaves: Node[]; start: number; end: number; cursor: Bookmark } | null {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    const startLeaf = leafElementAt(range.startContainer)
    const endLeaf = leafElementAt(range.endContainer)
    if (!startLeaf?.dataset.node || !endLeaf?.dataset.node) return null
    if (!this.root.contains(startLeaf) || !this.root.contains(endLeaf)) return null
    this.flushAll()
    const start = this.doc.getNode(startLeaf.dataset.node)
    const end = this.doc.getNode(endLeaf.dataset.node)
    if (!start || !end) return null
    const leaves = [start]
    for (let leaf = start; leaf !== end;) {
      const next = leaf.nextLeaf()
      if (!next) break
      leaves.push(next)
      leaf = next
    }
    const startOffset = offsetIn(startLeaf, range.startContainer, range.startOffset)
    const endOffset = offsetIn(endLeaf, range.endContainer, range.endOffset)
    return {
      leaves,
      start: startOffset,
      end: endOffset,
      cursor: { blockId: start.id, start: startOffset, end: start === end ? endOffset : startOffset },
    }
  }

  /** Wraps or unwraps a style over the selection, block by block (FMT-1 … FMT-3). */
  private toggleInline(style: Style, url = ''): boolean {
    const selected = this.selectedLeaves()
    if (!selected) return false
    const { leaves, start, end, cursor } = selected
    if (leaves.some((leaf) => !leaf.isInline())) return true
    const first = leaves[0]!
    const last = leaves[leaves.length - 1]!
    return this.transact(anchorsAround(first, last), cursor, () => {
      let caret: Bookmark | null = null
      leaves.forEach((leaf, index) => {
        const from = index === 0 ? start : 0
        const to = index === leaves.length - 1 ? end : leaf.text.length
        if (leaves.length > 1 && from === to) return
        const styled = toggleStyle(leaf.text, from, to, style, this.context, url)
        leaf.text = styled.text
        if (index === 0) caret = { blockId: leaf.id, start: styled.start, end: styled.end }
        if (index === leaves.length - 1 && leaves.length > 1 && caret) caret = { ...caret, end: caret.end }
      })
      if (leaves.length > 1 && caret) {
        // A selection across blocks keeps its shape: from the first leaf's styled start onward.
        const c: Bookmark = caret
        return { caret: { blockId: c.blockId, start: c.start, end: c.start } }
      }
      return { caret }
    })
  }

  /**
   * Links and images (FMT-4): applied at once with empty parentheses; when the clipboard turns out
   * to hold a URL and the caret still waits in those parentheses, the URL fills them.
   */
  private async toggleLink(style: Style) {
    if (!this.toggleInline(style)) return
    const waiting = bookmarkFromSelection(this.root)
    const pending = this.history.last
    let url = ''
    try {
      const clip = (await navigator.clipboard.readText()).trim()
      if (/^(https?:\/\/|mailto:|\/|\.\.?\/)\S+$/.test(clip)) url = clip
    } catch {
      return
    }
    const now = bookmarkFromSelection(this.root)
    if (url.length === 0 || !waiting || !now || this.history.last !== pending) return
    if (now.blockId !== waiting.blockId || now.start !== waiting.start || now.end !== waiting.end) return
    const leaf = elementFor(this.root, now.blockId)
    const text = leaf?.textContent ?? ''
    if (!leaf || text[now.start - 1] !== '(' || text[now.start] !== ')') return
    this.replaceSelectionWith(url, url.length, url.length)
    this.closeTyping()
  }

  /** Every inline marker in the selected blocks goes (FMT-5). */
  private clearFormat(): boolean {
    const selected = this.selectedLeaves()
    if (!selected) return false
    const { leaves, cursor } = selected
    const first = leaves[0]!
    const last = leaves[leaves.length - 1]!
    return this.transact(anchorsAround(first, last), cursor, () => {
      for (const leaf of leaves) if (leaf.isInline()) leaf.text = clearFormatting(leaf.text, this.context)
      return { caret: at(first.id, Math.min(cursor.start, first.text.length)) }
    })
  }

  /** Heading levels and Paragraph on the caret's block (FMT-7). */
  private heading(depth: number | null): boolean {
    const current = this.current()
    if (!current) return false
    const { node, bookmark } = current
    return this.transact(anchorsAround(node), bookmark, () => {
      const landing = setHeading(this.doc, node, depth, bookmark.start)
      return landing ? { caret: at(landing.leaf.id, landing.offset) } : null
    })
  }

  private blockCommand(run: (leaves: Node[]) => boolean): boolean {
    const selected = this.selectedLeaves()
    if (!selected) return false
    const { leaves, cursor } = selected
    const first = leaves[0]!
    const last = leaves[leaves.length - 1]!
    return this.transact(anchorsAround(first, last), cursor, () => (run(leaves) ? { caret: cursor } : null))
  }

  private listCommand(kind: ListKind): boolean {
    const selected = this.selectedLeaves()
    if (!selected) return false
    const { leaves, cursor } = selected
    const first = leaves[0]!
    const last = leaves[leaves.length - 1]!
    return this.transact(anchorsAround(first, last), cursor, () => {
      const landing = toggleList(this.doc, leaves, kind, cursor.start)
      return landing ? { caret: at(landing.leaf.id, landing.offset) } : null
    })
  }

  // --- repaint ---------------------------------------------------------------------------------

  private scheduleRepaint() {
    if (this.repaintTimer !== null) return
    this.repaintTimer = window.setTimeout(
      () => {
        this.repaintTimer = null
        if (this.composing || this.mouseDown) {
          this.scheduleRepaint()
          return
        }
        this.repaint()
      },
      this.busy ? BUSY_REPAINT_MS : REPAINT_MS,
    )
  }

  private repaint() {
    for (const id of this.queue) this.repaintBlock(id)
    this.queue.clear()
    this.expandAtSelection()
  }

  /** Reads every queued block's text into the model without touching the DOM (before a save). */
  private syncTexts() {
    for (const id of this.queue) {
      const element = elementFor(this.root, id)
      const node = this.doc.getNode(id)
      if (element && node) node.text = textOf(element)
    }
  }

  private repaintBlock(id: string) {
    const element = elementFor(this.root, id)
    const node = this.doc.getNode(id)
    if (!element || !node) return
    const text = textOf(element)
    const changed = text !== node.text
    node.text = text
    if (!changed) return
    if (node.type === 'table_cell' && node.parent?.parent) node.parent.parent.userText = undefined
    if (!node.isInline()) {
      // A verbatim block keeps its DOM — except that a fence with a known language re-colors
      // (FEN-1), and a trailing newline needs a line box to sit on.
      const colored = node.type === 'fence' && highlightLanguage(node.lang) !== null
      if (colored || text.endsWith('\n') || text.length === 0) {
        const bookmark = this.focusedId === id ? bookmarkFromSelection(this.root) : null
        element.innerHTML = node.type === 'fence' ? renderFenceInner(node) : renderVerbatimContent(text)
        if (bookmark && bookmark.blockId === id) this.restore(bookmark)
      }
      return
    }
    const bookmark = this.focusedId === id ? bookmarkFromSelection(this.root) : null
    if (node.type === 'paragraph') {
      // A list, quote or task marker on the caret's line converts the block at once (§8.2).
      const top = node.topLevel()
      const anchors = anchorsAround(...(top?.before ? [top.before, node] : [node]))
      const converted = this.transact(anchors, bookmark, () => {
        const transition = convertImmediate(this.doc, node, bookmark)
        return transition ? { caret: transition.bookmark } : null
      })
      if (converted) return
    }
    const html = renderInlineContent(node, this.context)
    const looksLike = looksLikeAttr(node).replace(/^ data-looks-like="|"$/g, '')
    if (looksLike.length > 0) element.dataset.looksLike = looksLike
    else delete element.dataset.looksLike
    if (normalizeHtml(element.innerHTML) === normalizeHtml(html)) return
    element.innerHTML = html
    if (bookmark && bookmark.blockId === id) this.restore(bookmark)
  }

  private restore(bookmark: Bookmark) {
    const range = rangeFromBookmark(this.root, bookmark)
    if (!range) return
    // Keys go to the focused editing host: when a re-render took it away, the root takes over — or,
    // in busy mode, the block itself.
    if (this.busy) {
      const leaf = elementFor(this.root, bookmark.blockId)
      if (leaf && leaf.dataset.type !== 'table_cell') {
        this.hostBlock(this.focusedId === bookmark.blockId ? null : this.focusedId, bookmark.blockId)
        if (leaf.getAttribute('contenteditable') !== 'true') leaf.contentEditable = 'true'
        if (document.activeElement !== leaf) leaf.focus({ preventScroll: true })
      }
      selectRange(range)
      return
    }
    const active = document.activeElement
    if (active !== this.root && !this.root.contains(active)) this.root.focus({ preventScroll: true })
    selectRange(range)
  }

  // --- expand: reveal the syntax under the caret (§6.5) ---------------------------------------

  private scheduleExpand() {
    if (this.expandFrame !== null) return
    this.expandFrame = window.requestAnimationFrame(() => {
      this.expandFrame = null
      this.expandAtSelection()
    })
  }

  private expandAtSelection() {
    for (const element of this.expanded) element.classList.remove('expanded')
    this.expanded = []
    for (const element of this.root.querySelectorAll('.focused-block')) element.classList.remove('focused-block')
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    const leaf = leafElementAt(range.startContainer)
    this.ensureTableTools(leaf && this.root.contains(leaf) ? leaf : null)
    if (!leaf || !this.root.contains(leaf)) return
    leaf.classList.add('focused-block')
    if (this.commitOnLeavingMarker(leaf)) return
    const wrappers = new Set<Element>()
    const start = wrapperAt(range.startContainer, range.startOffset)
    if (start) wrappers.add(climb(start))
    if (!range.collapsed) {
      const end = wrapperAt(range.endContainer, range.endOffset)
      if (end) wrappers.add(climb(end))
    }
    for (const wrapper of wrappers) {
      wrapper.classList.add('expanded')
      this.expanded.push(wrapper)
    }
  }

  /**
   * A previewed heading commits once the caret, having sat at the end of its marker, moves past
   * it — so `## T` is a heading as soon as the T is typed (§6.5 step 6). True when it committed.
   */
  private commitOnLeavingMarker(leaf: HTMLElement): boolean {
    const id = leaf.dataset.node
    const looksLike = leaf.dataset.looksLike ?? ''
    const marker = leaf.querySelector('.block-syntax')
    if (!id || !marker || !/^h[1-6]$/.test(looksLike)) {
      if (this.armed && (!id || this.armed !== id || !marker)) this.armed = null
      return false
    }
    const bookmark = bookmarkFromSelection(this.root)
    if (!bookmark || bookmark.blockId !== id) return false
    const markerLength = marker.textContent?.length ?? 0
    if (bookmark.start === markerLength && bookmark.start === bookmark.end) {
      this.armed = id
      return false
    }
    if (this.armed !== id || bookmark.start <= markerLength) return false
    this.armed = null
    const node = this.doc.getNode(id)
    if (!node) return false
    // The model must hold what the block reads now, not what its last repaint saw.
    this.flush(id)
    const cursor = bookmarkFromSelection(this.root) ?? bookmark
    return this.transact(anchorsAround(node), cursor, () => {
      const transition = commitBlock(this.doc, node, cursor)
      return transition ? { caret: transition.bookmark } : null
    })
  }

  // --- saving and the file on disk -------------------------------------------------------------

  content(): string {
    // Flush through the normal repaint path so reading a draft cannot suppress re-lexing.
    this.flushAll()
    return serializeDocument(this.doc)
  }

  format(command: EditorFormat) {
    this.root.focus({ preventScroll: true })
    if (!bookmarkFromSelection(this.root)) this.focusStart()
    if (command === 'bold') this.toggleInline(STYLES.strong)
    else if (command === 'italic') this.toggleInline(STYLES.em)
    else if (command === 'heading') this.heading(2)
    else if (command === 'paragraph') this.heading(null)
    else if (command === 'bullets') this.listCommand('ul')
    else if (command === 'undo') this.undo()
    else this.redo()
  }

  private markDirty() {
    if (this.state.local) {
      // Some structural commands finish updating the model after marking it dirty.
      queueMicrotask(() => {
        if (!this.destroyed) this.hooks.onChange?.(this.content())
      })
    }
    if (!this.dirty) {
      this.dirty = true
      this.hooks.onStatus('dirty', 'Unsaved')
    }
    this.scheduleSave(SAVE_IDLE_MS)
  }

  private scheduleSave(delay: number) {
    if (this.state.local) return
    this.clearSaveTimer()
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null
      void this.save(false)
    }, delay)
  }

  private clearSaveTimer() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
    this.saveTimer = null
  }

  async save(force: boolean) {
    if (this.state.local) {
      this.hooks.onChange?.(this.content())
      return
    }
    if (this.saving) {
      this.scheduleSave(SAVE_IDLE_MS)
      return
    }
    if (this.conflict && !force) return
    this.syncTexts()
    const content = serializeDocument(this.doc)
    this.saving = true
    this.hooks.onStatus('saving', 'Saving…')
    try {
      const result = await saveDocument(this.state.apiPath, content, this.version, force)
      if (result.status === 'conflict') {
        this.conflict = true
        this.hooks.onConflict(true)
        this.hooks.onStatus('conflict', 'Changed on disk')
        return
      }
      this.version = result.version
      this.conflict = false
      this.hooks.onConflict(false)
      this.syncTexts()
      if (serializeDocument(this.doc) === content) {
        this.dirty = false
        this.hooks.onStatus('saved', 'Saved')
      } else {
        this.scheduleSave(SAVE_IDLE_MS)
      }
    } catch (error) {
      this.hooks.onStatus('error', error instanceof Error ? error.message : 'Could not save')
      if (!this.destroyed) this.scheduleSave(SAVE_RETRY_MS)
    } finally {
      this.saving = false
    }
  }

  private async poll() {
    if (this.destroyed || this.saving) return
    try {
      const snapshot = await fetchSnapshot(this.state.apiPath, true)
      if (this.destroyed || snapshot.version === this.version) return
      if (this.dirty) {
        if (!this.conflict) {
          this.conflict = true
          this.hooks.onConflict(true)
          this.hooks.onStatus('conflict', 'Changed on disk')
        }
        return
      }
      await this.reloadFromDisk('Reloaded disk version')
    } catch {
      // The next tick tries again.
    }
  }

  /** Shows the file as it is on disk, keeping the caret in the same block where possible (MODE-5). */
  async reloadFromDisk(status: string) {
    if (this.state.local) return
    const snapshot = await fetchSnapshot(this.state.apiPath, false)
    if (this.destroyed) return
    this.replaceDocument(snapshot.content ?? '', snapshot.version)
    this.dirty = false
    this.conflict = false
    this.clearSaveTimer()
    this.hooks.onConflict(false)
    this.hooks.onStatus('saved', status)
  }

  /** The whole document replaced from new content — one undo step (UND-7). */
  private replaceDocument(content: string, version: number) {
    this.closeTyping()
    const bookmark = bookmarkFromSelection(this.root)
    const index = bookmark ? this.leafIndex(bookmark.blockId) : -1
    const anchors: Anchors = { before: null, after: null }
    const before = this.snapshot(anchors)
    this.queue.clear()
    this.temporary = null
    parseInto(this.doc, content)
    this.version = version
    this.ensureBlock()
    this.root.innerHTML = renderDocument(this.doc, this.context)
    this.applyBusyMode()
    this.noteFrontmatter()
    let cursor: Bookmark | null = null
    if (bookmark && index >= 0) {
      const leaves = this.root.querySelectorAll<HTMLElement>('.end-block[data-node]')
      const leaf = leaves[Math.min(index, leaves.length - 1)]
      if (leaf?.dataset.node) {
        const offset = Math.min(bookmark.start, textOf(leaf).length)
        cursor = at(leaf.dataset.node, offset)
        this.restore(cursor)
      }
    }
    this.history.push({
      kind: 'range',
      anchors,
      before,
      after: this.snapshot(anchors),
      cursorBefore: bookmark,
      cursorAfter: cursor,
    })
    this.expandAtSelection()
  }

  private leafIndex(id: string): number {
    const leaves = [...this.root.querySelectorAll<HTMLElement>('.end-block[data-node]')]
    return leaves.findIndex((leaf) => leaf.dataset.node === id)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer)
    if (this.repaintTimer !== null) window.clearTimeout(this.repaintTimer)
    if (this.expandFrame !== null) window.cancelAnimationFrame(this.expandFrame)
    this.clearSaveTimer()
    for (const { target, type, handler } of this.listeners) target.removeEventListener(type, handler)
    if (!this.state.local && this.dirty && !this.conflict && !this.saving) void this.save(false)
  }
}

/** Is a source offset inside a code span's content (where a paste stays literal, CLP-10)? */
function insideCodeSpan(nodes: InlineNode[], offset: number): boolean {
  let at = 0
  for (const node of nodes) {
    const length = sourceOf(node).length
    if (node.type === 'code' && offset > at + node.open.length && offset < at + length - node.close.length) return true
    if (node.type === 'emphasis' || node.type === 'link' || node.type === 'underline') {
      const inner = node.type === 'emphasis' ? node.delim.length : node.type === 'link' ? 1 : node.open.length
      if (insideCodeSpan(node.children, offset - at - inner)) return true
    }
    at += length
  }
  return false
}

/** Rendering that is the same up to what the browser and the expand step add. */
function normalizeHtml(html: string): string {
  return html
    .replace(/ class="([^"]*)"/g, (_, classes: string) => {
      const kept = classes
        .split(' ')
        .filter((name) => name !== 'expanded' && name.length > 0)
        .join(' ')
      return kept.length > 0 ? ` class="${kept}"` : ''
    })
    .replace(/<br>$/, '')
}

/** The inline wrapper holding a DOM position. */
function wrapperAt(container: globalThis.Node, offset: number): Element | null {
  if (container.nodeType === globalThis.Node.TEXT_NODE) {
    return container.parentElement?.closest('[data-inline]') ?? null
  }
  const child = container.childNodes[offset - 1] ?? container.childNodes[offset] ?? null
  const element = child instanceof Element ? child : child?.parentElement
  return element?.closest('[data-inline]') ?? null
}

/** Climbs while the wrapper is the only inline child of its parent wrapper, so `[**text**](url)` expands whole. */
function climb(wrapper: Element): Element {
  let current = wrapper
  for (;;) {
    const parent = current.parentElement?.closest('[data-inline]')
    if (!parent) return current
    const inlineChildren = [...parent.querySelectorAll('[data-inline]')].filter(
      (candidate) => candidate.parentElement?.closest('[data-inline]') === parent,
    )
    if (inlineChildren.length !== 1) return current
    current = parent
  }
}
