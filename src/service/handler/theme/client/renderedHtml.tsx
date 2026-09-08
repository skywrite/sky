import { useMemo } from 'react'

/** Keep unchanged text nodes mounted so background polling does not erase the reader's selection. */
export function RenderedHtml({ html, className }: { html: string; className: string }) {
  // React compares this prop object by identity, then assigns innerHTML even when its string is unchanged.
  const markup = useMemo(() => ({ __html: html }), [html])
  return <div className={className} dangerouslySetInnerHTML={markup} />
}
