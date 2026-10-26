import { ActionIcon, Button, Tooltip } from '@mantine/core'
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { Tick } from '../day/day.tsx'
import { clearMatches, findMatches, findPattern, type Match, paintMatches } from '../editor/find.ts'
import type { EditorHandle } from '../editor/wysiwyg/mod.ts'
import './explorerFind.css'

/**
 * Find and replace, in a box floating over the top right of the open file (⌘F, ⌥⌘F, or the ⋯
 * menu). It searches the text as shown — the reader's or the editor's — and paints the matches
 * without touching the page. Replacing needs the editor: asking for it while reading starts
 * editing. Replace all is one step on the editor's undo stack, and the page's toast offers Undo.
 */

/** Asks for the box: `seq` changes on every ⌘F, so a second press while it is open focuses it again. */
export interface FindRequest {
  seq: number
  replace: boolean
}

/** What was last searched for, kept for the next time the box opens on this page. */
const remembered = { query: '', replacement: '', matchCase: false, wholeWord: false, showReplace: false }

/** Where the current match was, so a fresh search after an edit carries on from there. */
interface Anchor {
  blockId: string | null
  block: number
  start: number
}

function anchorOf(match: Match, past = 0): Anchor {
  return { blockId: match.edit?.blockId ?? null, block: match.block, start: match.start + past }
}

/** The first match at or after the anchor, back to the first when none is. */
function indexFrom(matches: Match[], anchor: Anchor): number {
  const same =
    anchor.blockId === null
      ? -1
      : matches.findIndex((match) => match.edit?.blockId === anchor.blockId && match.start >= anchor.start)
  if (same !== -1) return same
  const later = matches.findIndex(
    (match) => match.block > anchor.block || (match.block === anchor.block && match.start >= anchor.start),
  )
  return later === -1 ? 0 : later
}

/** The first match not above the top of the view, so a new search starts where the reader is. */
function firstInView(matches: Match[], scroller: HTMLElement): number {
  const top = scroller.getBoundingClientRect().top
  const index = matches.findIndex((match) => match.range.getBoundingClientRect().bottom > top)
  return index === -1 ? 0 : index
}

/** Scrolls a match into view, clear of the box. */
function reveal(range: Range, scroller: HTMLElement, box: HTMLElement | null) {
  const view = scroller.getBoundingClientRect()
  const rect = range.getBoundingClientRect()
  const cover = box?.getBoundingClientRect()
  const covered = cover !== undefined && rect.top < cover.bottom && rect.right > cover.left && rect.left < cover.right
  if (!covered && rect.top >= view.top && rect.bottom <= view.bottom - 40) return
  const clear = cover ? cover.bottom - view.top + 24 : 0
  scroller.scrollBy({ top: rect.top - view.top - Math.max(scroller.clientHeight / 3, clear) })
}

const TIP = { hover: true, focus: true, touch: false }

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={up ? 'M3.5 10 8 5.5l4.5 4.5' : 'M3.5 6 8 10.5 12.5 6'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Close() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function FindBox({
  request,
  editing,
  editor,
  scroller,
  onEdit,
  onReplaced,
  onClose,
}: {
  request: FindRequest
  editing: boolean
  editor: RefObject<EditorHandle | null>
  /** The page's scrolling column; the document's body is inside it */
  scroller: RefObject<HTMLDivElement | null>
  /** Replacing needs the editor: switch to it */
  onEdit(): void
  /** After Replace all, the line the page's toast shows */
  onReplaced(text: string): void
  onClose(): void
}) {
  const [query, setQuery] = useState(remembered.query)
  const [replacement, setReplacement] = useState(remembered.replacement)
  const [matchCase, setMatchCase] = useState(remembered.matchCase)
  const [wholeWord, setWholeWord] = useState(remembered.wholeWord)
  // Reading, the replace field waits until it is asked for: showing it means editing.
  const [showReplace, setShowReplace] = useState(remembered.showReplace && editing)
  const [switching, setSwitching] = useState(false)
  const [found, setFound] = useState({ total: 0, current: -1 })
  const box = useRef<HTMLElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const matches = useRef<Match[]>([])
  const current = useRef(-1)
  const anchor = useRef<Anchor | null>(null)
  /** The next search, after a replace, scrolls to the match it lands on. */
  const revealNext = useRef(false)
  /** The replace field takes the keys once the editor asked for is up. */
  const focusReplace = useRef(false)
  const settings = useRef({ query, matchCase, wholeWord, editing, onEdit })
  settings.current = { query, matchCase, wholeWord, editing, onEdit }
  const replacing = showReplace && (editing || switching)

  useEffect(() => {
    Object.assign(remembered, { query, replacement, matchCase, wholeWord, showReplace })
  }, [query, replacement, matchCase, wholeWord, showReplace])

  useEffect(() => {
    if (editing) setSwitching(false)
  }, [editing])

  const startReplacing = useCallback(() => {
    setShowReplace(true)
    if (settings.current.editing) return
    setSwitching(true)
    focusReplace.current = true
    settings.current.onEdit()
  }, [])

  const show = useCallback(
    (index: number, scroll: boolean) => {
      current.current = index
      const match = matches.current[index]
      anchor.current = match ? anchorOf(match) : null
      paintMatches(matches.current, index)
      setFound({ total: matches.current.length, current: index })
      if (match && scroll && scroller.current) reveal(match.range, scroller.current, box.current)
    },
    [scroller],
  )

  /** Searches the document again: a new query starts at the view, an edit keeps the current match. */
  const search = useCallback(
    (from: 'view' | 'anchor', scroll: boolean) => {
      const root = scroller.current?.querySelector<HTMLElement>('.sky-doc-body') ?? null
      const pattern = findPattern(settings.current.query, settings.current)
      matches.current = root && pattern ? findMatches(root, pattern) : []
      let index = -1
      if (matches.current.length > 0 && scroller.current) {
        index =
          from === 'anchor' && anchor.current
            ? indexFrom(matches.current, anchor.current)
            : firstInView(matches.current, scroller.current)
      }
      show(index, scroll)
    },
    [scroller, show],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => search('view', true), 60)
    return () => window.clearTimeout(timer)
  }, [query, matchCase, wholeWord, search])

  // The document changes under the box — typing, a replace, undo, the file saved elsewhere, the
  // switch to editing — and the matches follow, the current one held where it was.
  useEffect(() => {
    const target = scroller.current
    if (!target) return
    let timer: number | undefined
    const observer = new MutationObserver((records) => {
      if (records.every((record) => box.current?.contains(record.target))) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        search('anchor', revealNext.current)
        revealNext.current = false
        if (focusReplace.current && editor.current) {
          focusReplace.current = false
          replaceInput.current?.focus()
        }
      }, 120)
    })
    observer.observe(target, { childList: true, characterData: true, subtree: true })
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [scroller, search, editor])

  useEffect(() => () => clearMatches(), [])

  // Every ⌘F: the box takes the keys, with a selection in the document as the thing to find.
  const { seq, replace } = request
  useEffect(() => {
    const selected = document.getSelection()
    const text = selected && !selected.isCollapsed ? selected.toString() : ''
    const node = selected?.anchorNode
    const inDocument = node ? scroller.current?.contains(node) && !box.current?.contains(node) : false
    if (inDocument && text.trim() && text.length <= 200 && !text.includes('\n')) setQuery(text)
    if (replace) startReplacing()
    findInput.current?.focus()
    findInput.current?.select()
  }, [seq, replace, scroller, startReplacing])

  const step = (delta: 1 | -1) => {
    const total = matches.current.length
    if (total === 0) return
    show((current.current + delta + total) % total, true)
  }

  const replaceOne = () => {
    if (!editing || !editor.current) return
    search('anchor', false)
    const match = matches.current[current.current]
    if (!match?.edit || editor.current.replaceText([match.edit], replacement) === 0) return
    anchor.current = anchorOf(match, replacement.length)
    revealNext.current = true
  }

  const replaceAll = () => {
    if (!editing || !editor.current) return
    search('anchor', false)
    const edits = matches.current.flatMap((match) => (match.edit ? [match.edit] : []))
    const done = edits.length > 0 ? editor.current.replaceText(edits, replacement) : 0
    if (done === 0) return
    const places = `${done} ${done === 1 ? 'place' : 'places'}`
    onReplaced(
      replacement ? `Replaced “${query}” with “${replacement}” in ${places}` : `Deleted “${query}” in ${places}`,
    )
  }

  /** Esc: the box goes, the current match left selected — in the editor, ready to type over. */
  const close = () => {
    const match = matches.current[current.current]
    clearMatches()
    onClose()
    if (!match) return
    if (match.edit && editing && editor.current) {
      editor.current.selectText(match.edit)
      return
    }
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(match.range)
  }

  const count = query.trim() === '' ? '' : found.total === 0 ? 'No matches' : `${found.current + 1} of ${found.total}`
  const none = found.total === 0

  return (
    <section
      ref={box}
      className="sky-findbox"
      aria-label="Find and replace"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.preventDefault()
        close()
      }}
    >
      <div className="sky-findbox-row">
        <Tooltip label={replacing ? 'Hide replace' : 'Replace (⌥⌘F)'} events={TIP}>
          <ActionIcon
            size="lg"
            className="sky-findbox-fold"
            aria-label={replacing ? 'Hide replace' : 'Show replace'}
            aria-expanded={replacing}
            onClick={() => (replacing ? setShowReplace(false) : startReplacing())}
          >
            <Chevron />
          </ActionIcon>
        </Tooltip>
        <div className="sky-findbox-field">
          <input
            ref={findInput}
            type="text"
            aria-label="Find in this file"
            placeholder="Find"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              step(event.shiftKey ? -1 : 1)
            }}
          />
          <Tooltip label="Match case" events={TIP}>
            <button
              type="button"
              className="sky-findbox-opt"
              aria-label="Match case"
              aria-pressed={matchCase}
              onClick={() => setMatchCase(!matchCase)}
            >
              Aa
            </button>
          </Tooltip>
          <Tooltip label="Whole word" events={TIP}>
            <button
              type="button"
              className="sky-findbox-opt"
              aria-label="Whole word"
              aria-pressed={wholeWord}
              onClick={() => setWholeWord(!wholeWord)}
            >
              <u>ab</u>
            </button>
          </Tooltip>
        </div>
        <span className="sky-findbox-count" aria-live="polite">
          {count}
        </span>
        <Tooltip label="Previous (⇧↵)" events={TIP}>
          <ActionIcon size="lg" aria-label="Previous match" disabled={none} onClick={() => step(-1)}>
            <Arrow up />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Next (↵)" events={TIP}>
          <ActionIcon size="lg" aria-label="Next match" disabled={none} onClick={() => step(1)}>
            <Arrow up={false} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Close (Esc)" events={TIP}>
          <ActionIcon size="lg" className="sky-findbox-close" aria-label="Close find" onClick={close}>
            <Close />
          </ActionIcon>
        </Tooltip>
      </div>
      {replacing && (
        <div className="sky-findbox-row">
          <span className="sky-findbox-gap" />
          <div className="sky-findbox-field">
            <input
              ref={replaceInput}
              type="text"
              aria-label="Replace with"
              placeholder="Replace with"
              spellCheck={false}
              value={replacement}
              onChange={(event) => setReplacement(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                if (event.metaKey || event.ctrlKey) replaceAll()
                else replaceOne()
              }}
            />
          </div>
          <Button size="sm" disabled={!editing || none} onClick={replaceOne}>
            Replace
          </Button>
          <Button size="sm" disabled={!editing || none} onClick={replaceAll}>
            Replace all
          </Button>
        </div>
      )}
    </section>
  )
}

/** After Replace all: what changed, with Undo for a moment. */
export function ReplacedToast({ text, onUndo }: { text: string; onUndo(): void }) {
  return (
    <div className="sky-undo sky-doc-undo" role="status">
      <span className="sky-undo-tick">
        <Tick />
      </span>
      <span className="sky-undo-text">{text}</span>
      <button type="button" className="sky-undo-btn" onClick={onUndo}>
        Undo
      </button>
      <span className="sky-undo-track">
        <span className="sky-undo-fill" />
      </span>
    </div>
  )
}
