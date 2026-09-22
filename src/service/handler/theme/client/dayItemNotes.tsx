import { useMemo } from 'react'
import { fileHref, resolvePath } from './explorer.tsx'
import { RenderedHtml } from './renderedHtml.tsx'
import { renderStatic } from './wysiwyg/render.ts'

export function itemNotes(raw: string): string {
  return raw
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.replace(/^ {1,2}/, ''))
    .join('\n')
    .trim()
}

/** Notes belong to the task's Markdown block, including after a move to another day. */
export function DayItemNotes({ source, at }: { source: string; at: string }) {
  const html = useMemo(() => {
    const template = document.createElement('template')
    template.innerHTML = renderStatic(source)
    for (const anchor of template.content.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') ?? ''
      if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
        if (!/^(?:https?:|mailto:|tel:)/i.test(href)) anchor.removeAttribute('href')
        continue
      }
      // App routes (including Source chat) already resolve from the origin.
      if (href.startsWith('/') || href.startsWith('#')) continue
      const [, encoded, suffix] = /^([^?#]*)(.*)$/.exec(href)!
      let file = encoded
      try {
        file = decodeURIComponent(file)
      } catch {
        /* A literal percent sign is still a valid filename. */
      }
      anchor.setAttribute('href', fileHref(resolvePath(at, file).replace(/^\/+/, '')) + suffix)
    }
    return template.innerHTML
  }, [source, at])
  return <RenderedHtml className="sky-item-notes sky-rendered" html={html} />
}
