import type { Page } from 'playwright'
import { launchGoogleBrowser, openGooglePage } from '../../lib/browserSession.ts'

// Real anchored comments, which the Drive API cannot create on editor files
// (anchors are opaque internal ids — see comments.ts): drive the actual
// editor UI instead. Slides comments anchor to the addressed slide; Sheets
// comments anchor to the addressed cell, because the URL fragment both
// navigates and selects. Success is verified API-side by the caller
// (list_comments shows UI-created comments with real anchors).

export function slidesCommentUrl(presentationId: string, slideObjectId: string): string {
  return `https://docs.google.com/presentation/d/${encodeURIComponent(presentationId)}/edit#slide=id.${slideObjectId}`
}

export function sheetsCommentUrl(spreadsheetId: string, sheetId: number, range: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit#gid=${sheetId}&range=${encodeURIComponent(range)}`
}

export function docsCommentUrl(documentId: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`
}

/** Cmd+Option+M → type → Cmd+Enter. The docos editor class has been stable for a decade; typing is keyboard-driven so a rename only loses the readiness wait. */
async function typeComment(page: Page, comment: string): Promise<void> {
  await page.keyboard.press('Meta+Alt+KeyM')
  const box = page.locator('.docos-input-textarea, [contenteditable="true"][aria-label*="omment"]').last()
  await box.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined)
  await page.waitForTimeout(800)
  await page.keyboard.type(comment, { delay: 12 })
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
}): Promise<{ level: 'element' | 'slide' }> {
  // Headless: input is injected via the automation protocol, so no visible
  // window is needed — and a popping window would steal the user's focus.
  const context = await launchGoogleBrowser({ headless: true })
  try {
    const page = await openGooglePage(context, slidesCommentUrl(options.presentationId, options.slideObjectId))
    await page.waitForTimeout(3000)
    let level: 'element' | 'slide' = 'slide'
    const canvas = options.anchor
      ? await page
          .locator('#canvas')
          .boundingBox()
          .catch(() => null)
      : null
    if (options.anchor && canvas) {
      await page.mouse.click(
        canvas.x + options.anchor.xRatio * canvas.width,
        canvas.y + options.anchor.yRatio * canvas.height,
      )
      await page.waitForTimeout(500)
      level = 'element'
    } else {
      await page.mouse.click(720, 470)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    }
    await typeComment(page, options.comment)
    return { level }
  } finally {
    await context.close()
  }
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
}): Promise<void> {
  const context = await launchGoogleBrowser({ headless: true })
  try {
    const page = await openGooglePage(context, docsCommentUrl(options.documentId))
    await page.waitForTimeout(4000)
    // Two spaced clicks reliably hand the canvas keyboard focus (probe-verified).
    await page.mouse.click(700, 300)
    await page.waitForTimeout(800)
    await page.mouse.click(700, 300)
    await page.waitForTimeout(800)
    await page.keyboard.press('Meta+KeyF')
    await page.waitForTimeout(800)
    await page.keyboard.type(options.searchText, { delay: 15 })
    await page.waitForTimeout(1200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    // Closing the find bar keeps the match selected — the comment binds to it.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    await typeComment(page, options.comment)
  } finally {
    await context.close()
  }
}

/** Comment anchored to one cell: the #gid=…&range=… fragment selects it on load. */
export async function addSheetsComment(options: {
  spreadsheetId: string
  sheetId: number
  range: string
  comment: string
}): Promise<void> {
  const context = await launchGoogleBrowser({ headless: true })
  try {
    const page = await openGooglePage(context, sheetsCommentUrl(options.spreadsheetId, options.sheetId, options.range))
    await page.waitForTimeout(2500)
    await typeComment(page, options.comment)
  } finally {
    await context.close()
  }
}
