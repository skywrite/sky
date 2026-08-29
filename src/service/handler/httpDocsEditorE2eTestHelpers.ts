// The block editor's end-to-end suite: a temp notebook, the app served on a free port, Brave
// headless driving the explorer page. Left out of `dev:test:unit` (a real browser); run it with
// `bun test service/handler/http-docs-editor-*-e2e_test.ts`.

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

export interface DocsEditorE2eFixture {
  origin: string
  page: Page
  previewFile: string
}

const BRAVE_EXECUTABLE_PATH =
  env.get('BRAVE_EXECUTABLE_PATH') ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'

const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
const DEFAULT_AUTOSAVE_WAIT_MS = 1200

async function launchChromiumOrSkip(t: TestContext): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: true,
      executablePath: BRAVE_EXECUTABLE_PATH,
    })
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

export async function runDocsEditorE2e(
  t: TestContext,
  options: {
    initialMarkdown: string
    tempPrefix: string
  },
  run: (fixture: DocsEditorE2eFixture) => Promise<void>,
) {
  const notebookBaseDir = await mkdtemp(path.join(os.tmpdir(), options.tempPrefix))
  let browser: Browser | undefined
  let server: RunningServer | undefined

  try {
    const previewDir = path.join(notebookBaseDir, 'notes')
    const previewFile = path.join(previewDir, 'preview.md')
    await mkdir(previewDir, { recursive: true })
    await writeFile(previewFile, options.initialMarkdown)

    const app = createTestHttpApp([previewDir])
    browser = await launchChromiumOrSkip(t)
    server = startAppServer(app)
    const page = await browser.newPage()

    await run({
      origin: server.origin,
      page,
      previewFile,
    })
  } finally {
    if (browser) {
      await browser.close()
    }
    if (server) {
      await server.close()
    }
    await rm(notebookBaseDir, { recursive: true, force: true })
  }
}

export async function openDocsEditor(page: Page, origin: string) {
  await page.goto(`${origin}/explorer/notes/preview.md`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.waitForSelector('.editable-block')
}

export async function activateFirstEditableBlock(page: Page) {
  await page.click('.editable-block[data-interactive="true"] .editable-block-preview-shell')
}

export async function clearActiveBlock(page: Page) {
  await page.keyboard.press(SELECT_ALL_SHORTCUT)
  await page.keyboard.press('Backspace')
}

export function modShortcut(key: string) {
  const normalized = key.length === 1 ? key.toUpperCase() : key
  return process.platform === 'darwin' ? `Meta+${normalized}` : `Control+${normalized}`
}

export async function waitForAutosave(page: Page, timeoutMs = DEFAULT_AUTOSAVE_WAIT_MS) {
  await page.waitForTimeout(timeoutMs)
}

export async function readMarkdownFromDisk(previewFile: string) {
  return await readFile(previewFile, 'utf-8')
}

export async function dispatchPasteHtml(page: Page, selector: string, html: string, plainText = '') {
  await page.evaluate(
    ({ selector, html, plainText }) => {
      const target = document.querySelector(selector)
      if (!(target instanceof HTMLElement)) {
        throw new Error(`Paste target not found: ${selector}`)
      }

      const clipboardData = new DataTransfer()
      clipboardData.setData('text/html', html)
      clipboardData.setData('text/plain', plainText)

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', {
        configurable: true,
        enumerable: true,
        value: clipboardData,
      })

      target.dispatchEvent(pasteEvent)
    },
    { selector, html, plainText },
  )
}

export async function dispatchPasteData(
  page: Page,
  selector: string,
  options: { html?: string; markdown?: string; plainText?: string },
) {
  await page.evaluate(
    ({ selector, options }) => {
      const target = document.querySelector(selector)
      if (!(target instanceof HTMLElement)) {
        throw new Error(`Paste target not found: ${selector}`)
      }

      const clipboardData = new DataTransfer()
      if (options.html !== undefined) {
        clipboardData.setData('text/html', options.html)
      }
      if (options.markdown !== undefined) {
        clipboardData.setData('text/markdown', options.markdown)
      }
      if (options.plainText !== undefined) {
        clipboardData.setData('text/plain', options.plainText)
      }

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', {
        configurable: true,
        enumerable: true,
        value: clipboardData,
      })

      target.dispatchEvent(pasteEvent)
    },
    { selector, options },
  )
}
