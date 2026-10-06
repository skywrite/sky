import { createRequire } from 'node:module'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright'
import { resolveDownloadLocations } from '../downloadLocations.ts'
import { NATIVE_BROWSER } from '../signIn/nativeBrowser.ts'
import { ExistingBrowserError, type ExistingBrowserSettings } from './settings.ts'

export type PageProtocol = Pick<CDPSession, 'send' | 'on' | 'off'>
export interface ExistingBrowserConnection {
  context: BrowserContext
  page: Page
  downloadDirectories?: readonly string[]
  protocol(page: Page): Promise<PageProtocol>
  close(): Promise<void>
}

// Sky pins Playwright. Its exported MCP factory supplies the official extension
// relay, which public chromium.connectOverCDP alone cannot establish.
const require = createRequire(import.meta.url)
const { tools } = require('playwright-core/lib/coreBundle') as {
  tools: {
    resolveCLIConfigForMCP(options: Record<string, unknown>, env: Record<string, string>): Promise<unknown>
    createBrowserWithInfo(
      config: unknown,
      client: { clientName: string },
      options: Record<string, unknown>,
    ): Promise<{ browser: Browser }>
  }
}

/** Only called inside a task worker: the token never reaches model tools or driver files. */
export async function connectExistingBrowser(
  token: string,
  settings: ExistingBrowserSettings,
  options: { signal?: AbortSignal; executablePath?: string; userDataDir?: string; homeDir?: string } = {},
): Promise<ExistingBrowserConnection> {
  let browser: Browser | undefined
  let page: Page | undefined
  const previousToken = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN
  try {
    options.signal?.throwIfAborted()
    process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = token
    const args = {
      extension: true,
      executablePath: options.executablePath ?? NATIVE_BROWSER.executablePath,
      profileDirName: settings.profileDirName,
      ...(options.userDataDir ? { userDataDir: options.userDataDir } : {}),
    }
    const config = await tools.resolveCLIConfigForMCP(args, {})
    browser = (await tools.createBrowserWithInfo(config, { clientName: 'Sky' }, args)).browser
    options.signal?.throwIfAborted()
    const context = browser.contexts()[0]
    if (!context) throw new Error('No extension context')
    // Never reuse, navigate, or close a pre-existing tab, even if shared with the extension.
    page = await context.newPage()
    const ownedPage = page
    const connected = browser
    const downloads = await resolveDownloadLocations({ ...options, profileDirName: settings.profileDirName })
    return {
      context,
      page,
      downloadDirectories: downloads.locations.map((location) => location.path),
      protocol: existingPageProtocol,
      close: async () => {
        // A background renderer can stop answering input and page-close calls.
        // Disconnect the relay even when that tab never acknowledges close.
        await Promise.race([ownedPage.close().catch(() => {}), delay(2000, undefined, { ref: false })])
        // A CDP-connected Browser.close disconnects the relay; it does not quit Brave.
        await connected.close().catch(() => {})
      },
    }
  } catch {
    await page?.close().catch(() => {})
    await browser?.close().catch(() => {})
    throw new ExistingBrowserError(
      'Sky could not connect to your Brave browser. Open Brave with the Playwright extension enabled in the connected profile. If its token changed, reconnect in Settings → Browser automation. Your browser task has not started.',
    )
  } finally {
    if (previousToken === undefined) delete process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN
    else process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = previousToken
  }
}

async function existingPageProtocol(page: Page): Promise<PageProtocol> {
  // chrome.debugger forbids Target.attachToBrowserTarget, which newCDPSession
  // requires. Use the already-attached tab session from the pinned in-process
  // client. Sky owns Fetch interception here, including redirect checks and
  // response streams; Playwright routing must not also consume these events.
  const internal = page as unknown as {
    _connection: {
      toImpl(page: Page): {
        delegate: { _mainFrameSession: { _client: PageProtocol & { removeAllListeners(event: string): void } } }
      }
    }
  }
  const protocol = internal._connection.toImpl(page).delegate._mainFrameSession._client
  protocol.removeAllListeners('Fetch.requestPaused')
  return protocol
}
