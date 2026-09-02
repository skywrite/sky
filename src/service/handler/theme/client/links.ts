/**
 * Web addresses in plain text, found so the page can make them links.
 * A trailing full stop, comma, or bracket belongs to the sentence, not
 * the address.
 */

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
