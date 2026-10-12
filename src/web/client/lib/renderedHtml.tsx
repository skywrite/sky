import { useLayoutEffect, useMemo, useRef } from 'react'

/** Keep unchanged text nodes mounted so background polling does not erase the reader's selection. */
export function RenderedHtml({ html, className }: { html: string; className: string }) {
  // React compares this prop object by identity, then assigns innerHTML even when its string is unchanged.
  const markup = useMemo(() => ({ __html: html }), [html])
  return <div className={className} dangerouslySetInnerHTML={markup} />
}

/**
 * HTML that grows block by block, as a streaming reply does. Blocks whose HTML is unchanged keep
 * their nodes — and a selection made in them — while the blocks after them are redrawn.
 */
export function RenderedBlocks({ blocks, className }: { blocks: string[]; className: string }) {
  const root = useRef<HTMLDivElement>(null)
  const shown = useRef<{ html: string; nodes: ChildNode[] }[]>([])
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    let kept = 0
    while (kept < blocks.length && shown.current[kept]?.html === blocks[kept]) kept++
    for (const stale of shown.current.splice(kept)) for (const node of stale.nodes) node.remove()
    for (const html of blocks.slice(kept)) {
      const template = document.createElement('template')
      template.innerHTML = html
      const nodes = [...template.content.childNodes]
      el.append(...nodes)
      shown.current.push({ html, nodes })
    }
  }, [blocks])
  return <div ref={root} className={className} />
}
