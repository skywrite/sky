import { useMemo } from 'react'
import type { OutboxGlyph } from './outboxPresentation.ts'
import { RenderedHtml } from './renderedHtml.tsx'
import { renderStatic } from './wysiwyg/render.ts'

/** The small pieces every outbox page shares: rendered text, the pen, the row glyphs. */

/**
 * Markdown from the notebook, rendered read-only. Only web, mail, and phone
 * links stay live. A message's own headings read as bold lines: the page
 * keeps its one heading.
 */
export function OutboxText({
  text,
  className,
  demoteHeadings = false,
}: {
  text: string
  className: string
  demoteHeadings?: boolean
}) {
  const html = useMemo(() => {
    const doc = new DOMParser().parseFromString(renderStatic(text), 'text/html')
    if (demoteHeadings) {
      for (const heading of doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
        const line = doc.createElement('p')
        line.className = 'sky-outbox-heading-line'
        line.innerHTML = heading.innerHTML
        heading.replaceWith(line)
      }
    }
    for (const link of doc.querySelectorAll('a[href]')) {
      try {
        if (
          !['http:', 'https:', 'mailto:', 'tel:'].includes(
            new URL(link.getAttribute('href')!, window.location.href).protocol,
          )
        )
          link.removeAttribute('href')
      } catch {
        link.removeAttribute('href')
      }
    }
    return doc.body.innerHTML
  }, [text, demoteHeadings])
  return <RenderedHtml className={`${className} sky-rendered`} html={html} />
}

export function Pen() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z" />
    </svg>
  )
}

/** The row's glyph: # for a channel, @ for a direct message, an envelope for email. */
export function Glyph({ kind }: { kind: OutboxGlyph }) {
  return (
    <span className="sky-outbox-glyph" data-kind={kind} aria-hidden="true">
      {kind === 'email' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="m3.5 7 8.5 6 8.5-6" />
        </svg>
      ) : kind === 'channel' ? (
        '#'
      ) : (
        '@'
      )}
    </span>
  )
}
