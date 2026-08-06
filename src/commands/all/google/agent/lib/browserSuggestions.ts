import { openGooglePage, withGoogleBrowser } from '../../lib/browserSession.ts'
import { docsCommentUrl } from './browserComments.ts'

// Real suggested edits (tracked changes), which the Docs API cannot create —
// batchUpdate always applies edits directly, and Suggesting mode exists only
// in the editor UI: drive the actual editor instead, exactly like anchored
// comments. Success is verified API-side by the caller (documents.get lists
// pending suggestion ids — listDocSuggestionIds).

/**
 * A suggested edit as the keyboard makes it: from the start of the found
 * anchor, walk right past the unchanged prefix, select the doomed span, and
 * type its replacement. Trimming the shared prefix/suffix keeps the recorded
 * suggestion minimal — a pure insertion strikes nothing out, a one-word swap
 * touches one word.
 */
export interface EditWindow {
  /** ArrowRight presses from the anchor start to the first differing character. */
  caretAdvance: number
  /** Shift+ArrowRight presses — the span the suggestion deletes (0 for pure insertions). */
  selectCount: number
  /** What the suggestion inserts there ('' for pure deletions). */
  typeText: string
}

export function editWindow(searchText: string, replacement: string): EditWindow {
  const shorter = Math.min(searchText.length, replacement.length)
  let prefix = 0
  while (prefix < shorter && searchText[prefix] === replacement[prefix]) prefix++
  let suffix = 0
  while (
    suffix < shorter - prefix &&
    searchText[searchText.length - 1 - suffix] === replacement[replacement.length - 1 - suffix]
  ) {
    suffix++
  }
  return {
    caretAdvance: prefix,
    selectCount: searchText.length - prefix - suffix,
    typeText: replacement.slice(prefix, replacement.length - suffix),
  }
}

/**
 * Suggested edit anchored to text in a Doc: the editor's own find selects the
 * requested occurrence of searchText (which stays selected after the find bar
 * closes), then the caret walks to the edit window and types — in Suggesting
 * mode, so the keystrokes record as one Accept/Reject-able suggestion instead
 * of an edit. Callers pre-verify that searchText occurs in the document at
 * least occurrence times: on a find miss the caret is unanchored, and typing
 * there would suggest text at a random spot.
 */
export async function suggestDocsEdit(options: {
  documentId: string
  searchText: string
  replacement: string
  /** 1-based match to edit in reading order (default: the first). */
  occurrence?: number
}): Promise<void> {
  const occurrence = options.occurrence ?? 1
  const window = editWindow(options.searchText, options.replacement)
  await withGoogleBrowser({ headless: true }, async (context) => {
    const page = await openGooglePage(context, docsCommentUrl(options.documentId))
    await page.waitForTimeout(4000)
    // Two spaced clicks reliably hand the canvas keyboard focus (probe-verified).
    await page.mouse.click(700, 300)
    await page.waitForTimeout(800)
    await page.mouse.click(700, 300)
    await page.waitForTimeout(800)
    // Cmd+Option+Shift+X: Suggesting mode, before any caret work — every
    // keystroke from here must record as a suggestion. A no-op under
    // commenter access, where the editor is suggest-only anyway.
    await page.keyboard.press('Meta+Alt+Shift+KeyX')
    await page.waitForTimeout(800)
    await page.keyboard.press('Meta+KeyF')
    await page.waitForTimeout(800)
    await page.keyboard.type(options.searchText, { delay: 15 })
    await page.waitForTimeout(1200)
    // The first Enter lands on the first match; each further Enter advances
    // one match in reading order.
    for (let i = 0; i < occurrence; i++) {
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)
    }
    // Closing the find bar keeps the match selected.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    // Collapse to the anchor start, then walk to the edit window.
    await page.keyboard.press('ArrowLeft')
    for (let i = 0; i < window.caretAdvance; i++) await page.keyboard.press('ArrowRight')
    for (let i = 0; i < window.selectCount; i++) await page.keyboard.press('Shift+ArrowRight')
    if (window.typeText) {
      await page.keyboard.type(window.typeText, { delay: 12 })
    } else if (window.selectCount > 0) {
      await page.keyboard.press('Backspace')
    }
    // Let the edit sync to Drive before the browser dies.
    await page.waitForTimeout(2500)
    // Cmd+Option+Shift+Z: back to Editing mode. The mode sticks per
    // user+document across sessions, and this profile is a real person's
    // account — left in Suggesting mode, their own later edits would
    // silently become suggestions.
    await page.keyboard.press('Meta+Alt+Shift+KeyZ')
    await page.waitForTimeout(600)
  })
}
