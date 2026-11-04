import type { MouseEvent } from 'react'

/** Notebook paths in messages are relative to the notebook root, not the thread's browser URL. */
export function chatLinkHref(href: string): string {
  if (/^\/(?!\/)/.test(href)) return dayFileOf(href) ?? href
  if (/^(?:[a-z][a-z\d+.-]*:|\/|[?#])/i.test(href)) return href
  const url = new URL(href, 'https://notebook.invalid/')
  if (!/\.md$/i.test(url.pathname)) return href
  return `/explorer${url.pathname}${url.search}${url.hash}`
}

/**
 * A day's file named by its full path on this Mac, such as `…/attachments/2030/04/01/Brief.pdf`. The browser
 * cannot open a path on the Mac, so the link opens the file as the day's files page serves it. Null for any other path.
 */
function dayFileOf(filePath: string): string | null {
  const url = new URL(filePath, 'https://notebook.invalid/')
  const file = /\/attachments\/(\d{4})\/(\d{2})\/(\d{2})\/(.+)$/.exec(url.pathname)
  return file ? `/day/${file[1]}-${file[2]}-${file[3]}/files/${file[4]}${url.search}${url.hash}` : null
}

/**
 * A link in a chat opens in a new tab, so the conversation stays where it is. The browser keeps the
 * rest: a click with a key held, a link that names where it opens, a download, a jump within the
 * page, and an address that is not a web page (an email, a phone number, an app).
 */
export function onChatLinkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const anchor = (event.target as Element).closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute('download')) return
  // In text being written the click places the caret, and the page stays.
  if (anchor.isContentEditable) {
    event.preventDefault()
    return
  }
  const url = new URL(anchor.href)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  const here = url.origin === location.origin && url.pathname === location.pathname && url.search === location.search
  if (url.hash && here) return
  event.preventDefault()
  window.open(url.href, '_blank', 'noopener,noreferrer')
}
