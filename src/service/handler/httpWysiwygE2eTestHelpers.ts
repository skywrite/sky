// The editor's end-to-end suite: a temp notebook, the app served on a free port, Brave headless
// driving the explorer page. Left out of `dev:test:unit` (a real browser); run it with
// `bun test service/handler/http-wysiwyg-*-e2e_test.ts`. Tests are named by the behavior
// specification's ids.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { type Browser, chromium, type Page } from 'playwright'
import { env } from '#shared/sys/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

interface TestContext {
  skip: (message?: string) => void
}

interface RunningServer {
  origin: string
  close: () => Promise<void>
}

export interface WysiwygE2eFixture {
  origin: string
  page: Page
  /** The file under edit on disk. */
  file: string
  /** The file's notebook-relative path — what the explorer opens. */
  relativePath: string
  /** The user-data directory the app was given: day attachments and the media mirror land here. */
  userDataDir: string
  /** Uncaught page errors and console errors so far — an assertion can demand none. */
  errors: string[]
}

const BRAVE_EXECUTABLE_PATH =
  env.get('BRAVE_EXECUTABLE_PATH') ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

/** The repaint pass runs 200 ms after an input; settle waits it out with room to spare. */
const SETTLE_MS = 350
/** Autosave fires a second after the last edit. */
const AUTOSAVE_MS = 1400

export const ROOT = '.sky-wysiwyg[contenteditable]'

async function launchChromiumOrSkip(t: TestContext): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true, executablePath: BRAVE_EXECUTABLE_PATH })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Executable doesn't exist") || error.message.includes('Failed to launch'))
    ) {
      t.skip(`Unable to launch Brave for e2e test at ${BRAVE_EXECUTABLE_PATH}`)
    }
    throw error
  }
}

function startAppServer(app: { fetch: (request: Request) => Response | Promise<Response> }): RunningServer {
  const server: ServerType = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  const addr = server.address()
  const port = addr && typeof addr === 'object' ? addr.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

export async function runWysiwygE2e(
  t: TestContext,
  options: { initialMarkdown: string; tempPrefix: string; file?: string },
  run: (fixture: WysiwygE2eFixture) => Promise<void>,
) {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), options.tempPrefix))
  let browser: Browser | undefined
  let server: RunningServer | undefined
  try {
    const relativePath = options.file ?? 'notes/preview.md'
    const rootDir = path.join(notebookBaseDir, relativePath.split('/')[0]!)
    const file = path.join(notebookBaseDir, relativePath)
    const userDataDir = path.join(notebookBaseDir, 'user-data')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, options.initialMarkdown)
    const app = createTestHttpApp([rootDir], { userDataDir })
    browser = await launchChromiumOrSkip(t)
    server = startAppServer(app)
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('404')) errors.push(`console: ${message.text()}`)
    })
    try {
      await run({ origin: server.origin, page, file, relativePath, userDataDir, errors })
    } finally {
      if (errors.length > 0) console.error(`[e2e page errors]\n${errors.join('\n')}`)
    }
  } finally {
    if (browser) await browser.close()
    if (server) await server.close()
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
}

export async function openEditor(page: Page, origin: string, relativePath = 'notes/preview.md') {
  await page.goto(`${origin}/explorer/${relativePath.split('/').map(encodeURIComponent).join('/')}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.waitForSelector(ROOT)
}

/** Puts a collapsed caret at a character offset of a leaf block — hidden syntax counts. */
export async function placeCaret(page: Page, selector: string, offset: number) {
  await page.evaluate(
    ({ selector, offset }) => {
      const leaf = document.querySelector(selector)
      if (!(leaf instanceof HTMLElement)) throw new Error(`No leaf at ${selector}`)
      const root = leaf.closest<HTMLElement>('[contenteditable="true"]')
      root?.focus()
      const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node instanceof Element
            ? node.hasAttribute('data-chrome')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_SKIP
            : NodeFilter.FILTER_ACCEPT,
      })
      let total = 0
      let last: Text | null = null
      const range = document.createRange()
      let placed = false
      for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
        if (offset <= total + text.length) {
          range.setStart(text, offset - total)
          placed = true
          break
        }
        total += text.length
        last = text
      }
      if (!placed) {
        if (last) range.setStart(last, last.length)
        else range.setStart(leaf, 0)
      }
      range.collapse(true)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    },
    { selector, offset },
  )
}

/** The text of every element the selector matches, as the editor reads it: chrome such as a fence's language box left out. */
export async function leafTexts(page: Page, selector: string): Promise<string[]> {
  return await page.evaluate((selector) => {
    return [...document.querySelectorAll(selector)].map((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node instanceof Element
            ? node.hasAttribute('data-chrome')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_SKIP
            : NodeFilter.FILTER_ACCEPT,
      })
      let text = ''
      for (let n = walker.nextNode(); n; n = walker.nextNode()) text += (n as Text).data
      return text
    })
  }, selector)
}

/** The caret's character offset inside its leaf, and the leaf's node id. */
export async function caretOffset(page: Page): Promise<{ block: string | null; offset: number }> {
  return await page.evaluate(() => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) return { block: null, offset: -1 }
    const range = selection.getRangeAt(0)
    const start = range.startContainer
    const element = start instanceof Element ? start : start.parentElement
    const leaf = element?.closest<HTMLElement>('.end-block')
    if (!leaf) return { block: null, offset: -1 }
    const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node instanceof Element
          ? node.hasAttribute('data-chrome')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP
          : NodeFilter.FILTER_ACCEPT,
    })
    let total = 0
    for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
      if (text === start) return { block: leaf.dataset.node ?? null, offset: total + range.startOffset }
      total += text.length
    }
    return { block: leaf.dataset.node ?? null, offset: total }
  })
}

export async function waitForSettle(page: Page) {
  await page.waitForTimeout(SETTLE_MS)
}

export async function waitForAutosave(page: Page) {
  await page.waitForTimeout(AUTOSAVE_MS)
}

export async function readMarkdownFromDisk(file: string) {
  return await readFile(file, 'utf-8')
}

export async function writeMarkdownToDisk(file: string, content: string) {
  await writeFile(file, content)
}

/** A 1×1 PNG, base64. */
export const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** A 1×1 PNG next to the file under edit, for image tests; its notebook-relative name. */
export async function writeSiblingPng(file: string, name: string) {
  await writeFile(path.join(path.dirname(file), name), Buffer.from(PNG_1X1_BASE64, 'base64'))
}

/** Pastes a file into the editor the way a screenshot or a copied file arrives: a File on the clipboard data. */
export async function dispatchFilePaste(page: Page, file: { name: string; type: string; base64: string }) {
  await page.evaluate((file) => {
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], file.name, { type: file.type }))
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
    const selection = document.getSelection()
    const anchor = selection?.anchorNode
    const target =
      (anchor instanceof Element ? anchor : anchor?.parentElement) ?? document.querySelector('.sky-wysiwyg')!
    target.dispatchEvent(event)
  }, file)
}

export function modShortcut(key: string) {
  const normalized = key.length === 1 ? key.toUpperCase() : key
  return process.platform === 'darwin' ? `Meta+${normalized}` : `Control+${normalized}`
}

/** Whether the syntax spans inside a wrapper are shown (display other than none). */
export async function syntaxVisible(page: Page, selector: string): Promise<boolean[]> {
  return await page.evaluate((selector) => {
    return [...document.querySelectorAll(`${selector} .syntax`)].map(
      (span) => getComputedStyle(span).display !== 'none',
    )
  }, selector)
}

/**
 * Fires a copy, cut or paste at the editor with the given flavors, and returns the flavors the
 * editor left on the event — what a real clipboard would hold.
 */
export async function dispatchClipboard(
  page: Page,
  type: 'copy' | 'cut' | 'paste',
  data: Record<string, string> = {},
): Promise<Record<string, string>> {
  return await page.evaluate(
    ({ type, data }) => {
      const transfer = new DataTransfer()
      for (const [flavor, value] of Object.entries(data)) transfer.setData(flavor, value)
      const event = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: transfer })
      const selection = document.getSelection()
      const anchor = selection?.anchorNode
      const target =
        (anchor instanceof Element ? anchor : anchor?.parentElement) ?? document.querySelector('.sky-wysiwyg')!
      target.dispatchEvent(event)
      const out: Record<string, string> = {}
      for (const flavor of transfer.types) out[flavor] = transfer.getData(flavor)
      return out
    },
    { type, data },
  )
}
