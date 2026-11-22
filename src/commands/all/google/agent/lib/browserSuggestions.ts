import type { Page } from 'playwright'
import { openGooglePage, withGoogleBrowser } from '#lib/google/browserSession.ts'
import { docsCommentUrl, focusDocsCanvas } from './browserComments.ts'
import { selectDocMatch } from './findBar.ts'

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
 * Insert replacement text without touching the system clipboard (connected
 * Brave shares the person's macOS pasteboard, and the extension relay rejects
 * browser-level clipboard permission grants) and without per-character
 * keystrokes (which trigger smart-quote/dash autocorrect). Dispatch an
 * in-memory paste event to the active editor target (Docs listens on its
 * hidden text-event iframe and calls preventDefault); when the page does not
 * handle synthetic paste, commit the string directly via CDP insertText.
 */
export async function insertSuggestedText(page: Page, text: string): Promise<void> {
  const pasted = await page
    .evaluate((value) => {
      let doc: Document = document
      while (doc.activeElement?.tagName === 'IFRAME') {
        const inner = (doc.activeElement as HTMLIFrameElement).contentDocument
        if (!inner) break
        doc = inner
      }
      const target = doc.activeElement ?? doc.body
      if (!target) return false
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', value)
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })
      return !target.dispatchEvent(event)
    }, text)
    .catch(() => false)
  if (!pasted) {
    await page.keyboard.insertText(text)
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
  /** Multi-tab docs: the tab holding searchText — the editor opens on it. */
  tabId?: string
  account?: string
}): Promise<void> {
  const occurrence = options.occurrence ?? 1
  const window = editWindow(options.searchText, options.replacement)
  await withGoogleBrowser({ headless: true }, async (session) => {
    const targetUrl = docsCommentUrl(options.documentId, options.tabId, options.account)
    const alreadyOpen =
      !session.page.isClosed() &&
      session.page.url().includes(`/document/d/${encodeURIComponent(options.documentId)}/edit`)
    const page = await openGooglePage(session, targetUrl, {
      account: options.account,
      reuseLoadedDoc: true,
    })
    if (!alreadyOpen) {
      await page.waitForTimeout(4000)
    } else {
      await page.keyboard.press('Escape').catch(() => undefined)
      await page.waitForTimeout(400)
    }
    await focusDocsCanvas(page)
    // Cmd+Option+Shift+X: Suggesting mode, before any caret work — every
    // keystroke from here must record as a suggestion. A no-op under
    // commenter access, where the editor is suggest-only anyway.
    await page.keyboard.press('Meta+Alt+Shift+KeyX')
    await page.waitForTimeout(800)
    await selectDocMatch(page, options.searchText, occurrence, options.tabId)
    // Collapse to the anchor start, then walk to the edit window.
    await page.keyboard.press('ArrowLeft')
    for (let i = 0; i < window.caretAdvance; i++) await page.keyboard.press('ArrowRight')
    for (let i = 0; i < window.selectCount; i++) await page.keyboard.press('Shift+ArrowRight')
    if (window.typeText) {
      await insertSuggestedText(page, window.typeText)
    } else if (window.selectCount > 0) {
      await page.keyboard.press('Backspace')
    }
    // Let the edit sync to Drive before the browser closes or navigates away.
    await page.waitForTimeout(2500)
    // Cmd+Option+Shift+Z: back to Editing mode. The mode sticks per
    // user+document across sessions, and this profile is a real person's
    // account — left in Suggesting mode, their own later edits would
    // silently become suggestions.
    await page.keyboard.press('Meta+Alt+Shift+KeyZ')
    await page.waitForTimeout(600)
  })
}
