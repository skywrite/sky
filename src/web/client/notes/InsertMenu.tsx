/**
 * The "/" menu. A line holding only "/" and a few words offers the blocks those words name, each
 * beside the markdown it writes. Up and Down choose, Enter, Tab or a click inserts in place of
 * the "/", and Escape leaves the "/" as typed.
 */

import { type CSSProperties, Fragment, type RefObject, useEffect, useRef, useState } from 'react'
import { bookmarkFromSelection, selectedLeaf, textOf } from '../editor/wysiwyg/bookmark.ts'
import type { EditorHandle } from '../editor/wysiwyg/mod.ts'
import { FormatIcon, type FormatIconName } from './FormatIcon.tsx'
import { type InsertCommand, type InsertOption, insertOptions, slashQuery } from './noteDocument.ts'

interface Asking {
  blockId: string
  /** The line as typed, "/" and words */
  text: string
  query: string
  at: { left: number; top: number; bottom: number }
}

const ICONS: Partial<Record<InsertCommand, FormatIconName>> = {
  heading1: 'heading1',
  heading2: 'heading2',
  heading3: 'heading3',
  bullets: 'bullets',
  numbers: 'numbers',
  tasks: 'tasks',
  quote: 'quote',
  codeblock: 'codeblock',
  table: 'table',
  divider: 'divider',
  image: 'image',
  link: 'link',
}

const MENU_WIDTH = 340
const ROOM = 12

/** Where the menu opens: under the line when there is room, above it otherwise. */
function placement(at: Asking['at']): CSSProperties {
  const left = Math.max(ROOM, Math.min(at.left, window.innerWidth - MENU_WIDTH - ROOM))
  const below = window.innerHeight - at.bottom - ROOM
  const above = at.top - ROOM
  if (below >= 260 || below >= above) return { left, top: at.bottom + 6, maxHeight: Math.max(160, below - 6) }
  return { left, bottom: window.innerHeight - at.top + 6, maxHeight: Math.max(160, above - 6) }
}

export function InsertMenu({
  editor,
  root,
  onImage,
}: {
  editor: RefObject<EditorHandle | null>
  root: RefObject<HTMLElement | null>
  /** Picks files to add beside the note */
  onImage: () => void
}) {
  const [asking, setAsking] = useState<Asking | null>(null)
  const [active, setActive] = useState(0)
  // A "/" the person closed with Escape stays plain text until the line changes.
  const declined = useRef<string | null>(null)
  const options = asking ? insertOptions(asking.query) : []

  useEffect(() => {
    const element = root.current
    if (!element) return
    const check = () => {
      const selection = document.getSelection()
      const leaf = selection?.isCollapsed ? selectedLeaf(element) : null
      const bookmark = leaf ? bookmarkFromSelection(element) : null
      // Only a paragraph of its own: inside a list, a quote or a table the "/" is just a character.
      if (!leaf || !bookmark || leaf.dataset.type !== 'paragraph' || leaf.parentElement !== element) {
        setAsking(null)
        return
      }
      const text = textOf(leaf)
      const query = slashQuery(text, bookmark.start)
      if (query === null || declined.current === `${bookmark.blockId}:${text}` || insertOptions(query).length === 0) {
        if (query === null) declined.current = null
        setAsking(null)
        return
      }
      const range = selection!.getRangeAt(0).getBoundingClientRect()
      const box = range.height > 0 ? range : leaf.getBoundingClientRect()
      setAsking({
        blockId: bookmark.blockId,
        text,
        query,
        at: { left: box.left - 8, top: box.top, bottom: box.bottom },
      })
    }
    document.addEventListener('selectionchange', check)
    element.addEventListener('input', check)
    window.addEventListener('scroll', check, true)
    window.addEventListener('resize', check)
    return () => {
      document.removeEventListener('selectionchange', check)
      element.removeEventListener('input', check)
      window.removeEventListener('scroll', check, true)
      window.removeEventListener('resize', check)
    }
  }, [root])

  const query = asking?.query
  useEffect(() => setActive(0), [query])

  const choose = (option: InsertOption | undefined) => {
    const handle = editor.current
    if (!option || !handle || !asking) return
    handle.selectText({ blockId: asking.blockId, start: 0, end: asking.text.length })
    handle.insertMarkdown('')
    setAsking(null)
    if (option.command === 'image') onImage()
    else handle.format(option.command)
  }

  // Keys while the menu is open belong to it: taken on the way down, before the editor sees them.
  useEffect(() => {
    const host = root.current?.parentElement
    if (!host || !asking) return
    const keys = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowDown') setActive((index) => (index + 1) % options.length)
      else if (event.key === 'ArrowUp') setActive((index) => (index - 1 + options.length) % options.length)
      else if (event.key === 'Enter' || event.key === 'Tab') choose(options[active])
      else if (event.key === 'Escape') {
        declined.current = `${asking.blockId}:${asking.text}`
        setAsking(null)
      } else return
      event.preventDefault()
      event.stopPropagation()
    }
    host.addEventListener('keydown', keys, true)
    return () => host.removeEventListener('keydown', keys, true)
  })

  if (!asking || options.length === 0) return null
  return (
    <div className="sky-insert-menu" role="listbox" aria-label="Insert" style={placement(asking.at)}>
      {options.map((option, index) => (
        <Fragment key={option.command}>
          {index > 0 && option.group !== options[index - 1]!.group && <div className="sky-insert-gap" />}
          <button
            type="button"
            role="option"
            aria-selected={index === active}
            className="sky-insert-option"
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(option)}
          >
            <span className="sky-insert-icon">
              <FormatIcon name={ICONS[option.command] ?? 'note'} size={17} />
            </span>
            <span className="sky-insert-label">{option.label}</span>
            <kbd className="sky-insert-mark">{option.mark}</kbd>
          </button>
        </Fragment>
      ))}
    </div>
  )
}
