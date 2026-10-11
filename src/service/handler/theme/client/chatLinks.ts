import type { MouseEvent } from 'react'

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
