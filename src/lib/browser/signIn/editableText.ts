import type { Page } from 'playwright'

// Playwright's snapshot keeps a form field's value but drops the text inside
// any other textbox, and a document editor marks each of its headings,
// paragraphs and table cells as one. A reader then sees the blocks'
// placeholders ("Heading 2", "List") and their links, and none of the words.
// Each such block's text goes back in as a text line under it, read through
// the block's own reference from the snapshot just taken.

/** Blocks read per snapshot, so one look at a very long document stays quick. */
export const MAX_BLOCKS = 500
/** A block gone by the time it is read stays as the snapshot had it. */
const READ_TIMEOUT_MS = 1000

/** A textbox line with no value of its own, with or without children: `- textbox [ref=e4] [box=…]:` */
const BARE_TEXTBOX = /^(\s*)- textbox(?: "(?:[^"\\]|\\.)*")?((?: \[[^\]]*\])*):?$/
const REF = /\[ref=((?:f\d+)?e\d+)\]/

/** One block's words, by its reference. */
export type ReadBlock = (ref: string) => Promise<string>

/** The snapshot with the words of every textbox that had none added under it. */
export async function addEditableText(snapshot: string, read: ReadBlock): Promise<string> {
  const lines = snapshot.split('\n')
  const blocks: { at: number; indent: string; ref: string }[] = []
  for (const [at, line] of lines.entries()) {
    if (blocks.length >= MAX_BLOCKS) break
    const match = line.match(BARE_TEXTBOX)
    const ref = match?.[2].match(REF)?.[1]
    if (match && ref) blocks.push({ at, indent: match[1], ref })
  }
  const texts = await Promise.all(blocks.map(({ ref }) => read(ref).catch(() => '')))
  // From the bottom up, so the lines above keep their places.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const text = texts[i].replace(/\s+/g, ' ').trim()
    if (!text) continue
    const { at, indent } = blocks[i]
    if (!lines[at].endsWith(':')) lines[at] += ':'
    // After the block's own properties, such as its placeholder, where Playwright puts them.
    let under = at + 1
    while (lines[under]?.startsWith(`${indent}  - /`)) under++
    lines.splice(under, 0, `${indent}  - text: ${yamlText(text)}`)
  }
  return lines.join('\n')
}

/** Quoted where YAML would read the text as something else, as Playwright quotes a snapshot's text. */
function yamlText(text: string): string {
  const quoted =
    /^[-&*\],?!>|@"'#%[]|:(?:\s|$)|\s#|[{}`]/.test(text) ||
    !Number.isNaN(Number(text)) ||
    /^(?:y|n|yes|no|true|false|on|off|null)$/i.test(text)
  return quoted ? JSON.stringify(text) : text
}

/** A block's words, read in the page; a form field's value is in the snapshot already. */
export function readBlocks(page: Page): ReadBlock {
  return (ref) =>
    page
      .locator(`aria-ref=${ref}`)
      .evaluate(
        (element) =>
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? ''
            : element instanceof HTMLElement
              ? element.innerText
              : (element.textContent ?? ''),
        undefined,
        { timeout: READ_TIMEOUT_MS },
      )
}
