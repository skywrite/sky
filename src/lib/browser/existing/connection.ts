import { createRequire } from 'node:module'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright'
import { resolveDownloadLocations } from '../downloadLocations.ts'
import { NATIVE_BROWSER } from '../signIn/nativeBrowser.ts'
import { ExistingBrowserError, type ExistingBrowserSettings } from './settings.ts'
import { backgroundTaskPage, closeTaskTabs, connectionPage, taskWindowLauncher } from './taskWindow.ts'

export type PageProtocol = Pick<CDPSession, 'send' | 'on' | 'off'>
export interface ExistingBrowserConnection {
  context: BrowserContext
  page: Page
  downloadDirectories?: readonly string[]
  protocol(page: Page): Promise<PageProtocol>
  /** Select only the owned task tab, preserving the foreground window. */
  activateTaskTab?(): Promise<void>
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
  options: {
    signal?: AbortSignal
    executablePath?: string
    userDataDir?: string
    homeDir?: string
    background?: boolean
  } = {},
): Promise<ExistingBrowserConnection> {
  let browser: Browser | undefined
  let page: Page | undefined
  let control: Page | undefined
  let closePages: (() => Promise<void>) | undefined
  let launcher: Awaited<ReturnType<typeof taskWindowLauncher>> | undefined
  const previousToken = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN
  try {
    options.signal?.throwIfAborted()
    process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = token
    const executablePath = options.executablePath ?? NATIVE_BROWSER.executablePath
    if (options.background) launcher = await taskWindowLauncher(executablePath)
    const args = {
      extension: true,
      executablePath: launcher?.executablePath ?? executablePath,
      profileDirName: settings.profileDirName,
      ...(options.userDataDir ? { userDataDir: options.userDataDir } : {}),
    }
    const config = await tools.resolveCLIConfigForMCP(args, {})
    browser = (await tools.createBrowserWithInfo(config, { clientName: 'Sky' }, args)).browser
    const context = browser.contexts()[0]
    if (!context) throw new Error('No extension context')
    // Never reuse, navigate, or close a pre-existing tab, even if shared with the extension.
    if (options.background) control = connectionPage(context)
    options.signal?.throwIfAborted()
    const task = control ? await backgroundTaskPage(context, control) : { page: await context.newPage() }
    page = task.page
    closePages = 'close' in task ? task.close : undefined
    const ownedPage = page
    const ownedControl = control
    const connected = browser
    const downloads = await resolveDownloadLocations({ ...options, profileDirName: settings.profileDirName })
    return {
      context,
      page,
      downloadDirectories: downloads.locations.map((location) => location.path),
      protocol: existingPageProtocol,
      ...('activateTaskTab' in task ? { activateTaskTab: task.activateTaskTab } : {}),
      close: async () => {
        // A background renderer can stop answering input and page-close calls.
        // Disconnect the relay even when that tab never acknowledges close.
        if (closePages) await Promise.race([closePages(), delay(2000, undefined, { ref: false })])
        else {
          await Promise.race([ownedPage.close().catch(() => {}), delay(2000, undefined, { ref: false })])
          if (ownedControl)
            await Promise.race([ownedControl.close().catch(() => {}), delay(2000, undefined, { ref: false })])
        }
        // A CDP-connected Browser.close disconnects the relay; it does not quit Brave.
        await connected.close().catch(() => {})
      },
    }
  } catch {
    if (closePages || control)
      await Promise.race([closePages?.() ?? closeTaskTabs(control!), delay(2000, undefined, { ref: false })])
    else await page?.close().catch(() => {})
    await browser?.close().catch(() => {})
    throw new ExistingBrowserError(
      'Sky could not connect to your Brave browser. Open Brave with the Playwright extension enabled in the connected profile. If its token changed, reconnect in Settings → Browser automation. Your browser task has not started.',
    )
  } finally {
    await launcher?.close().catch(() => {})
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
