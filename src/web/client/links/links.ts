/**
 * Web addresses in plain text, found so the page can make them links.
 * A trailing full stop, comma, or bracket belongs to the sentence, not
 * the address.
 */

import { lexInline, plainText } from '../editor/wysiwyg/lexer.ts'

export interface TextRun {
  text: string
  /** Set when the run is an address */
  url?: string
}

const URL = /https?:\/\/[^\s<>"']+/g

export function splitLinks(text: string): TextRun[] {
  const runs: TextRun[] = []
  let last = 0
  for (const match of text.matchAll(URL)) {
    let url = match[0]
    // Closing punctuation that ends the sentence, not the address.
    while (/[.,;:!?)\]]$/.test(url) && !(url.endsWith(')') && url.includes('('))) url = url.slice(0, -1)
    const start = match.index
    if (start > last) runs.push({ text: text.slice(last, start) })
    runs.push({ text: url, url })
    last = start + url.length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs
}

/**
 * A saved link that is a web address, not a notebook record:
 * `[Title](https://…)` or the address alone. Null for anything else,
 * including an address inside a sentence, which stays the words it was
 * saved as.
 */
export function webLinkOf(value: string): { href: string; title: string } | null {
  const nodes = lexInline(value.trim())
  const node = nodes.length === 1 ? nodes[0]! : null
  if (!node || (node.type !== 'link' && node.type !== 'autolink')) return null
  if (!/^https?:\/\//i.test(node.href)) return null
  const title = (node.type === 'link' ? plainText(node.children).trim() : '') || node.href
  // An untitled address reads as where it goes, as a profile's own links do.
  return { href: node.href, title: title.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '') }
}
