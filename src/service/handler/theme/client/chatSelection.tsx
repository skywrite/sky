import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { stageChatDraft } from './chatDraft.ts'
import './chatSelection.css'

interface Passage {
  text: string
  range: Range
  message: HTMLElement
  speaker: string
}

const sameRange = (a: Range, b: Range) =>
  a.startContainer === b.startContainer &&
  a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer &&
  a.endOffset === b.endOffset

export function quoteChatSelection(text: string, title: string, href: string, speaker: string): string {
  const label = title.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>]/g, '\\$&')
  const link = href.replaceAll('(', '%28').replaceAll(')', '%29')
  return `From [${label || 'Source chat'}](${link}) · ${speaker}\n\n${text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')}\n\n`
}

function readPassage(root: HTMLElement): Passage | null {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null
  const range = selection.getRangeAt(0)
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  if (!start || !end || !root.contains(start) || !root.contains(end)) return null
  if ([start, end].some((node) => node.closest('textarea, input, [contenteditable="true"]'))) return null
  const message = start.closest<HTMLElement>('[data-chat-message]')
  if (!message || message !== end.closest('[data-chat-message]') || message.dataset.streaming) return null
  // Only readable message content participates, never action labels or tool UI.
  const content = start.closest('.sky-rendered, .sky-para, .sky-bubble-text')
  const last = end.closest('.sky-rendered, .sky-para, .sky-bubble-text')
  if (!content || !last || !message.contains(content) || !message.contains(last)) return null
  if (content !== last && !(content.matches('.sky-para') && last.matches('.sky-para'))) return null
  const text = selection.toString().trim()
  if (!text) return null
  return { text, range: range.cloneRange(), message, speaker: message.dataset.speaker ?? 'Sky' }
}

function selectedTextRects(range: Range): DOMRect[] {
  const rects: DOMRect[] = []
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE || !range.intersectsNode(node)) continue
    const part = document.createRange()
    part.selectNodeContents(node)
    if (node === range.startContainer) part.setStart(node, range.startOffset)
    if (node === range.endContainer) part.setEnd(node, range.endOffset)
    if (!part.collapsed) rects.push(...part.getClientRects())
  }
  return rects.filter((rect) => rect.width > 0 && rect.height > 0)
}

function menuPosition(passage: Passage, menu: HTMLElement): { left: number; top: number } | null {
  const scroll = passage.message.closest('.sky-scroll, .sky-reply-panel-scroll')
  const area = scroll?.getBoundingClientRect()
  const left = Math.max(8, area?.left ?? 0)
  const right = Math.min(window.innerWidth - 8, area?.right ?? window.innerWidth)
  const top = Math.max(8, area?.top ?? 0)
  const bottom = Math.min(window.innerHeight - 8, area?.bottom ?? window.innerHeight)
  // Range bounds include full-width paragraph boxes. Measure the highlighted
  // text itself so blank space never pushes the action into a distant margin.
  const lines = selectedTextRects(passage.range).filter(
    (line) => line.bottom > top && line.top < bottom && line.right > left && line.left < right,
  )
  if (!lines.length) return null
  const first = lines[0]!
  const width = menu.offsetWidth
  const height = menu.offsetHeight
  const gap = 12
  const rightmost = lines.reduce((a, b) => (a.right >= b.right ? a : b))
  const leftmost = lines.reduce((a, b) => (a.left <= b.left ? a : b))
  const beside = (line: DOMRect) => Math.max(top, Math.min(line.top + (line.height - height) / 2, bottom - height))
  if (rightmost.right + gap + width <= right) return { left: rightmost.right + gap, top: beside(rightmost) }
  if (leftmost.left - gap - width >= left) return { left: leftmost.left - gap - width, top: beside(leftmost) }
  const boxTop = Math.min(...lines.map((line) => line.top))
  const boxBottom = Math.max(...lines.map((line) => line.bottom))
  const x = Math.max(left, Math.min(first.left, right - width))
  if (boxTop - gap - height >= top) return { left: x, top: boxTop - gap - height }
  if (boxBottom + gap + height <= bottom) return { left: x, top: boxBottom + gap }
  return { left: Math.max(left, right - width), top }
}

export function ChatSelectionMenu({
  root,
  chatId,
  title,
  saved,
}: {
  root: RefObject<HTMLDivElement | null>
  chatId: string
  title: string
  saved: string | null
}) {
  const [passage, setPassage] = useState<Passage | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentPassage = useRef(passage)
  currentPassage.current = passage
  const menu = useRef<HTMLDivElement>(null)
  const action = useRef<HTMLButtonElement>(null)
  const focusRequested = useRef(false)
  const dismissed = useRef<Range | null>(null)
  const starting = useRef(false)

  useEffect(() => {
    let dragging = false
    let frame = 0
    const update = () => {
      if (dragging || starting.current || menu.current?.contains(document.activeElement)) return
      const next = root.current ? readPassage(root.current) : null
      if (next && dismissed.current && sameRange(next.range, dismissed.current)) return
      dismissed.current = null
      const prior = currentPassage.current
      if ((!next && !prior) || (next && prior && next.text === prior.text && sameRange(next.range, prior.range))) return
      setPassage(next)
      setError(null)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const down = (event: PointerEvent) => {
      if (menu.current?.contains(event.target as Node)) return
      dismissed.current = null
      dragging = event.button === 0
      setPassage(null)
    }
    const up = () => {
      dragging = false
      schedule()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const selected = document.getSelection()
        dismissed.current = selected?.rangeCount ? selected.getRangeAt(0).cloneRange() : null
        setPassage(null)
      } else if (event.key === 'F10' && event.shiftKey && root.current && readPassage(root.current)) {
        event.preventDefault()
        dismissed.current = null
        focusRequested.current = true
        setPassage(readPassage(root.current))
      }
    }
    const focus = (event: FocusEvent) => {
      if ((event.target as Element)?.matches?.('textarea, input, [contenteditable="true"]')) setPassage(null)
    }
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('pointerdown', down)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
    document.addEventListener('keydown', key)
    document.addEventListener('focusin', focus)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      document.removeEventListener('keydown', key)
      document.removeEventListener('focusin', focus)
    }
  }, [root, chatId])

  useLayoutEffect(() => {
    const place = () => {
      setPosition(passage && menu.current && passage.message.isConnected ? menuPosition(passage, menu.current) : null)
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    const observer = new ResizeObserver(place)
    if (passage) observer.observe(passage.message)
    if (menu.current) observer.observe(menu.current)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [passage, error])

  useLayoutEffect(() => {
    if (position && focusRequested.current) {
      action.current?.focus({ preventScroll: true })
      focusRequested.current = false
    }
  }, [position])

  const start = async () => {
    if (!passage || starting.current) return
    starting.current = true
    setBusy(true)
    setError(null)
    const tab = window.open('', '_blank')
    if (tab) {
      tab.opener = null
      tab.document.title = 'Sky · Preparing new chat'
      tab.document.body.textContent = 'Preparing your selected passage…'
    }
    try {
      const anchor = encodeURIComponent(passage.message.id)
      const href = saved
        ? `/explorer/${saved.split('/').map(encodeURIComponent).join('/')}`
        : `/thread/${encodeURIComponent(chatId)}#${anchor}`
      const text = quoteChatSelection(passage.text, title, href, passage.speaker)
      const response = await fetch('/chat/selections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage.text }),
      })
      const result = (await response.json()) as { id?: string; message?: string }
      if (!response.ok || !result.id) throw new Error(result.message ?? 'The new chat could not be prepared.')
      const storageError = stageChatDraft(result.id, text)
      if (storageError) throw new Error(storageError)
      const destination = `/thread/${encodeURIComponent(result.id)}`
      if (tab && !tab.closed) tab.location.href = destination
      else window.location.assign(destination)
      dismissed.current = passage.range
      setPassage(null)
    } catch (problem) {
      tab?.close()
      setError(problem instanceof Error ? problem.message : 'The new chat could not be prepared. Try again.')
    } finally {
      starting.current = false
      setBusy(false)
    }
  }

  if (!passage) return null
  return createPortal(
    <div
      ref={menu}
      className="sky-chat-selection-menu"
      style={position ? { ...position, visibility: 'visible' } : { visibility: 'hidden' }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse') event.preventDefault()
      }}
    >
      <div role="menu" aria-label="Selected text">
        <button ref={action} type="button" role="menuitem" disabled={busy} onClick={() => void start()}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
          </svg>
          {busy ? 'Opening…' : 'New chat about this…'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>,
    document.body,
  )
}
