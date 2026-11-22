import type { Page } from 'playwright'
import { openGooglePage, withGoogleBrowser } from '#lib/google/browserSession.ts'
import { selectDocMatch } from './findBar.ts'

// Real anchored comments, which the Drive API cannot create on editor files
// (anchors are opaque internal ids — see comments.ts): drive the actual
// editor instead. Slides comments anchor to the addressed slide; Sheets
// comments anchor to the addressed cell, because the URL fragment both
// navigates and selects. Success is verified API-side by the caller
// (list_comments shows UI-created comments with real anchors).

function buildEditorUrl(baseUrl: string, params: Record<string, string | undefined>, hash?: string): string {
  const url = new URL(baseUrl)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value)
  }
  if (hash) url.hash = hash
  return url.toString()
}

export function slidesCommentUrl(presentationId: string, slideObjectId: string, account?: string): string {
  return buildEditorUrl(
    `https://docs.google.com/presentation/d/${encodeURIComponent(presentationId)}/edit`,
    { authuser: account },
    `slide=id.${slideObjectId}`,
  )
}

export function sheetsCommentUrl(spreadsheetId: string, sheetId: number, range: string, account?: string): string {
  return buildEditorUrl(
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
    { authuser: account },
    `gid=${sheetId}&range=${encodeURIComponent(range)}`,
  )
}

/** With a tabId, the URL opens the doc on that tab (multi-tab docs; same format as "Copy link to this tab"). */
export function docsCommentUrl(documentId: string, tabId?: string, account?: string): string {
  return buildEditorUrl(`https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`, {
    tab: tabId,
    authuser: account,
  })
}

/** Two spaced clicks inside the editor pane reliably hand the Docs canvas keyboard focus regardless of window width. */
export async function focusDocsCanvas(page: Page): Promise<void> {
  const editor = await page
    .locator('.kix-appview-editor')
    .first()
    .boundingBox()
    .catch(() => null)
  const viewport = page.viewportSize()
  const x = editor ? editor.x + editor.width / 2 : viewport ? viewport.width / 2 : 700
  const y = editor ? editor.y + Math.min(220, editor.height / 2) : 300
  await page.mouse.click(x, y)
  await page.waitForTimeout(800)
  await page.mouse.click(x, y)
  await page.waitForTimeout(800)
}

/**
 * Normalize comment text for Google's docos comment editor:
 * - Convert CRLF to LF, collapse 3+ newlines to a single blank line, and trim
 * - Convert standard Markdown **bold** to Google Docs' native *bold* syntax
 */
export function normalizeCommentText(comment: string): string {
  return comment
    .replaceAll('\r\n', '\n')
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Plain-text needle for Drive API read-back: Google strips *bold* and _italic_
 * delimiters from `comment.content` (moving formatting into `htmlContent`), so
 * match against the stripped first non-empty line.
 */
export function plainCommentNeedle(comment: string): string {
  const firstLine =
    normalizeCommentText(comment)
      .split('\n')
      .map((line) =>
        line
          .replace(/^[-*•]\s+/, '')
          .replace(/[*_]/g, '')
          .trim(),
      )
      .find((line) => line.length > 0) ?? ''
  return firstLine.slice(0, 40)
}

/**
 * Cmd+Option+M → insert lines with Shift+Enter breaks → Cmd+Enter.
 * Inserting each line via CDP insertText with Shift+Enter between lines is
 * fast, preserves blank-line paragraph spacing, and avoids raw Enter
 * keystrokes interacting with @-mention autocomplete.
 */
export async function typeComment(page: Page, comment: string): Promise<void> {
  const normalized = normalizeCommentText(comment)
  await page.keyboard.press('Meta+Alt+KeyM')
  const box = page.locator('.docos-input-textarea, [contenteditable="true"][aria-label*="omment"]').last()
  await box.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
  await page.waitForTimeout(800)
  const lines = normalized.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.length > 0) {
      await page.keyboard.insertText(lines[i]!)
    }
    if (i < lines.length - 1) {
      await page.keyboard.press('Shift+Enter')
    }
  }
  await page.waitForTimeout(400)
  await page.keyboard.press('Meta+Enter')
  await page.waitForTimeout(2500)
}

/**
 * Comment anchored to one slide, or to one element on it. With an element
 * anchor (page-relative click ratios), the editor's `#canvas` surface is
 * measured at runtime and the element clicked to select it before
 * commenting — the marker then attaches to that element. Without one, any
 * selection is cleared so the comment binds to the slide itself.
 */
export async function addSlidesComment(options: {
  presentationId: string
  slideObjectId: string
  comment: string
  anchor?: { xRatio: number; yRatio: number }
  account?: string
}): Promise<{ level: 'element' | 'slide' }> {
  return await withGoogleBrowser({ headless: true }, async (session) => {
    const page = await openGooglePage(
      session,
      slidesCommentUrl(options.presentationId, options.slideObjectId, options.account),
      { account: options.account },
    )
    await page.waitForTimeout(3000)
    let level: 'element' | 'slide' = 'slide'
    const canvas = await page
      .locator('#canvas')
      .boundingBox()
      .catch(() => null)
    if (options.anchor && canvas) {
      await page.mouse.click(
        canvas.x + options.anchor.xRatio * canvas.width,
        canvas.y + options.anchor.yRatio * canvas.height,
      )
      await page.waitForTimeout(500)
      level = 'element'
    } else {
      const x = canvas ? canvas.x + canvas.width / 2 : 720
      const y = canvas ? canvas.y + canvas.height / 2 : 470
      await page.mouse.click(x, y)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    }
    await typeComment(page, options.comment)
    return { level }
  })
}

/**
 * Comment anchored to text in a Doc: the editor's own find selects the first
 * occurrence of searchText, which stays selected after the find bar closes —
 * the comment then binds to that text. Callers pass a snippet distinctive
 * enough to be unique.
 */
export async function addDocsComment(options: {
  documentId: string
  searchText: string
  comment: string
  /** Multi-tab docs: the tab holding searchText — the editor opens on it. */
  tabId?: string
  account?: string
}): Promise<void> {
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
    // The counter-driven find selects the true first match — the blind
    // type-and-Enter it replaces landed on match TWO whenever the snippet
    // repeated (fill focuses match 1; Enter advances). The comment binds to
    // the selection left behind.
    await selectDocMatch(page, options.searchText, 1, options.tabId)
    await typeComment(page, options.comment)
  })
}

/** Comment anchored to one cell: the #gid=…&range=… fragment selects it on load. */
export async function addSheetsComment(options: {
  spreadsheetId: string
  sheetId: number
  range: string
  comment: string
  account?: string
}): Promise<void> {
  await withGoogleBrowser({ headless: true }, async (session) => {
    const page = await openGooglePage(
      session,
      sheetsCommentUrl(options.spreadsheetId, options.sheetId, options.range, options.account),
      { account: options.account },
    )
    await page.waitForTimeout(2500)
    await typeComment(page, options.comment)
  })
}
