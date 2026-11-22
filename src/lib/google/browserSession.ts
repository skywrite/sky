import * as path from 'node:path'
import { chromium } from 'playwright'
import type { BrowserContext, Page } from 'playwright'
import { DIR_STATE } from '#config'
import { connectExistingBrowser, type ExistingBrowserConnection } from '#lib/browser/existing/connection.ts'
import { ExistingBrowserSettingsStore, type ExistingBrowserSettings } from '#lib/browser/existing/settings.ts'
import { browserBinary } from '#lib/browser/mcp/browserDriver.ts'
import { findChromiumBrowser } from '#lib/browser/persistentContext.ts'
import { unpackAppleExtension } from '#lib/browser/signIn/applePasswords.ts'
import { NATIVE_BROWSER, nativeBrowserAvailable } from '#lib/browser/signIn/nativeBrowser.ts'
import {
  SKY_PRIVATE_BROWSER_PROFILE,
  acquireBrowserProfile,
  BrowserSessionCookies,
  prepareBrowserProfile,
} from '#lib/browser/signIn/profile.ts'
import { prepareStoredLoginPage } from '#lib/browser/storedLoginPage.ts'
import { PasswordManagerSettingsStore } from '#lib/credentials/passwordManagers.ts'
import { exists } from '#shared/fs/mod.ts'

export { findChromiumBrowser }

export const CHROMIUM_PATHS = [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

export class GoogleBrowserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleBrowserError'
  }
}

export interface GoogleBrowserSession {
  readonly context: BrowserContext
  readonly page: Page
  /** True when attached to the user's connected Brave profile rather than Sky's persistent profile. */
  readonly existing: boolean
  /** Disconnects owned tabs (connected Brave) or saves cookies and closes the persistent context. */
  readonly close: () => Promise<void>
}

export interface GoogleBrowserOptions {
  headless?: boolean
  timeoutMs?: number
  closeAfter?: boolean
  signal?: AbortSignal
}

/** Launches that lose a Chromium startup race hang rather than fail — bound them. */
const LAUNCH_TIMEOUT_MS = 60_000

/**
 * Keep the shared browser session warm across consecutive flows in one mission
 * (e.g. a batch of anchored comments or suggested edits), shorter than
 * PrivateBrowserSession's 90s profile-lease wait so another task never starves.
 */
const WARM_IDLE_MS = 60_000

/** Wait long enough to outlast another process's warm idle window. */
const LOCK_WAIT_MS = 120_000

/**
 * Hard ceiling per flow, between the slowest legitimate flow (an anchored
 * comment ≈ 90s) and the agent's 180s tool timer. A wedged page operation gets
 * its session closed from under it so the queue advances.
 */
const FLOW_DEADLINE_MS = 150_000

export interface PersistentLaunchOptions {
  headless: boolean
  signal?: AbortSignal
}

export interface PersistentBrowserHandle {
  context: BrowserContext
  page: Page
  saveCookies: () => Promise<void>
  close: () => Promise<void>
}

export interface GoogleBrowserDependencies {
  settings: Pick<ExistingBrowserSettingsStore, 'read' | 'token'>
  connect: typeof connectExistingBrowser
  launchPersistent: (options: PersistentLaunchOptions) => Promise<PersistentBrowserHandle>
  preparePage: (page: Page) => Promise<void>
  warmIdleMs?: number
  flowDeadlineMs?: number
}

async function launchSharedPersistentProfile(options: PersistentLaunchOptions): Promise<PersistentBrowserHandle> {
  const profileDir = SKY_PRIVATE_BROWSER_PROFILE
  const releaseProfile = await acquireBrowserProfile(profileDir, options.signal, LOCK_WAIT_MS)
  try {
    await prepareBrowserProfile(profileDir)
    options.signal?.throwIfAborted()
    const passwordSettings = await new PasswordManagerSettingsStore(
      path.join(DIR_STATE, 'credentials', 'sources.json'),
    ).read()
    let executablePath: string | null = null
    let extension: string | undefined
    if (passwordSettings.nativeBrowser && (await nativeBrowserAvailable())) {
      executablePath = NATIVE_BROWSER.executablePath
      if (passwordSettings.nativeBrowser.applePasswords) {
        const archive = path.join(DIR_STATE, 'credentials', 'helpers', 'apple-passwords.crx')
        if (await exists(archive)) {
          extension = await unpackAppleExtension(archive, path.join(profileDir, 'sky-extensions'))
        }
      }
    } else {
      executablePath = await browserBinary()
    }
    if (!executablePath) {
      throw new GoogleBrowserError('No Chromium-family browser found for automation')
    }
    const context = await chromium.launchPersistentContext(profileDir, {
      executablePath,
      headless: options.headless,
      viewport: options.headless ? { width: 1440, height: 900 } : null,
      timeout: LAUNCH_TIMEOUT_MS,
      chromiumSandbox: true,
      ignoreDefaultArgs: ['--enable-automation', ...(extension ? ['--disable-extensions'] : [])],
      args: [
        '--disable-blink-features=AutomationControlled',
        ...(extension ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] : []),
      ],
    })
    try {
      const cookies = new BrowserSessionCookies(profileDir)
      await cookies.restore(context)
      const page = context.pages()[0] ?? (await context.newPage())
      for (const extra of context.pages().slice(1)) await extra.close().catch(() => undefined)
      return {
        context,
        page,
        saveCookies: () => cookies.save(context),
        close: async () => {
          await cookies.save(context).catch(() => undefined)
          await Promise.race([
            context.close().catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, 5000)),
          ])
          await releaseProfile()
        },
      }
    } catch (err) {
      await context.close().catch(() => undefined)
      throw err
    }
  } catch (err) {
    await releaseProfile().catch(() => undefined)
    throw err
  }
}

interface WarmSession {
  kind: 'existing' | 'persistent'
  profileDirName?: string
  headless: boolean
  context: BrowserContext
  page: Page
  closed: boolean
  idleTimer?: ReturnType<typeof setTimeout>
  activateTaskTab?: () => Promise<void>
  showTaskWindow?: () => Promise<void>
  saveCookies?: () => Promise<void>
  teardown: () => Promise<void>
}

function liveSessionPage(warm: WarmSession): Page | undefined {
  if (warm.closed) return undefined
  if (!warm.page.isClosed()) return warm.page
  if (warm.kind === 'existing') {
    const reattached = warm.context.pages().find((candidate) => !candidate.isClosed())
    if (reattached) {
      warm.page = reattached
      return reattached
    }
  }
  return undefined
}

function sameMode(warm: WarmSession, existing: ExistingBrowserSettings | undefined, headless: boolean): boolean {
  if (!liveSessionPage(warm)) return false
  if (existing) {
    return warm.kind === 'existing' && warm.profileDirName === existing.profileDirName && warm.headless === headless
  }
  return warm.kind === 'persistent' && warm.headless === headless
}

export function createGoogleBrowserController(
  deps: GoogleBrowserDependencies = {
    settings: new ExistingBrowserSettingsStore(),
    connect: connectExistingBrowser,
    launchPersistent: launchSharedPersistentProfile,
    preparePage: prepareStoredLoginPage,
  },
) {
  const warmIdleMs = deps.warmIdleMs ?? WARM_IDLE_MS
  const defaultDeadlineMs = deps.flowDeadlineMs ?? FLOW_DEADLINE_MS
  let profileQueue: Promise<unknown> = Promise.resolve()
  let warm: WarmSession | null = null
  let activeLeases = 0

  async function closeWarmSession(target: WarmSession | null = warm): Promise<void> {
    if (!target) return
    if (warm === target) warm = null
    target.closed = true
    clearTimeout(target.idleTimer)
    await Promise.race([target.teardown().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5000))])
  }

  async function openWarmSession(
    existing: ExistingBrowserSettings | undefined,
    headless: boolean,
    signal?: AbortSignal,
  ): Promise<WarmSession> {
    if (existing) {
      // An unavailable selected connection must never silently switch browser identities.
      const attached: ExistingBrowserConnection = await deps.connect(await deps.settings.token(), existing, {
        signal,
        background: headless,
      })
      const created: WarmSession = {
        kind: 'existing',
        profileDirName: existing.profileDirName,
        headless,
        context: attached.context,
        page: attached.page,
        closed: false,
        activateTaskTab: attached.activateTaskTab,
        showTaskWindow: attached.showTaskWindow,
        teardown: () => attached.close(),
      }
      // Extension 0.6+ detaches and re-announces the owned tab across renderer
      // swaps (150ms delay); update `created.page` when the re-attached Page
      // arrives, and mark closed only when the context itself disconnects.
      attached.context.on?.('page', (next: Page) => {
        created.page = next
      })
      attached.context.once('close', () => {
        created.closed = true
      })
      return created
    }

    const handle = await deps.launchPersistent({ headless, signal })
    const created: WarmSession = {
      kind: 'persistent',
      headless,
      context: handle.context,
      page: handle.page,
      closed: false,
      saveCookies: handle.saveCookies,
      teardown: handle.close,
    }
    handle.page.once('close', () => {
      created.closed = true
    })
    handle.context.once('close', () => {
      created.closed = true
    })
    return created
  }

  async function withGoogleBrowser<T>(
    options: GoogleBrowserOptions,
    fn: (session: GoogleBrowserSession) => Promise<T>,
  ): Promise<T> {
    const run = profileQueue.then(async () => {
      options.signal?.throwIfAborted()
      const headless = options.headless ?? false
      const existing = await deps.settings.read()
      if (warm && !sameMode(warm, existing, headless)) {
        await closeWarmSession(warm)
      }
      let active = warm
      if (active) {
        clearTimeout(active.idleTimer)
      } else {
        active = await openWarmSession(existing, headless, options.signal)
        warm = active
      }

      let deadline: ReturnType<typeof setTimeout> | undefined
      const timeoutMs = options.timeoutMs ?? defaultDeadlineMs
      const deadlineError = new GoogleBrowserError(
        `The browser flow exceeded ${timeoutMs / 1000}s and was force-closed — the next call starts a fresh browser`,
      )
      let deadlineHit = false
      const timeoutPromise = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          deadlineHit = true
          void closeWarmSession(active).finally(() => reject(deadlineError))
        }, timeoutMs)
      })

      try {
        options.signal?.throwIfAborted()
        const executeFlow = async () => {
          const currentPage = liveSessionPage(active) ?? active.page
          if (headless) {
            await deps.preparePage(currentPage)
          }
          await active.activateTaskTab?.()
          if (!headless) {
            await active.showTaskWindow?.()
          }
          const session: GoogleBrowserSession = {
            context: active.context,
            get page() {
              return liveSessionPage(active) ?? active.page
            },
            existing: active.kind === 'existing',
            close: () => closeWarmSession(active),
          }
          const result = await fn(session)
          if (liveSessionPage(active)) {
            await active.saveCookies?.().catch(() => undefined)
          }
          return result
        }
        const flowRun = executeFlow()
        void flowRun.catch(() => undefined)
        return await Promise.race([flowRun, timeoutPromise])
      } catch (err) {
        if (deadlineHit) throw deadlineError
        throw err
      } finally {
        clearTimeout(deadline)
        if (options.closeAfter && warm === active) {
          await closeWarmSession(active)
        } else if (warm === active && liveSessionPage(active)) {
          active.idleTimer = setTimeout(() => {
            profileQueue = profileQueue
              .then(() => (warm === active ? closeWarmSession(active) : undefined))
              .catch(() => undefined)
          }, warmIdleMs)
          ;(active.idleTimer as unknown as { unref?: () => void }).unref?.()
        } else if (warm === active) {
          await closeWarmSession(active)
        }
      }
    })
    profileQueue = run.catch(() => undefined)
    return await run
  }

  /**
   * Hold a mission-level lease on the warm browser: when the last retained
   * mission finishes, fold any parked warm session immediately so the service
   * neither holds the profile lock nor leaves a background task window open.
   */
  function retainGoogleBrowser(): () => Promise<void> {
    activeLeases++
    let released = false
    return async () => {
      if (released) return
      released = true
      activeLeases = Math.max(0, activeLeases - 1)
      if (activeLeases > 0) return
      const closing = profileQueue
        .then(() => (activeLeases === 0 && warm ? closeWarmSession(warm) : undefined))
        .catch(() => undefined)
      profileQueue = closing
      await closing
    }
  }

  return { withGoogleBrowser, retainGoogleBrowser }
}

const defaultController = createGoogleBrowserController()

export const withGoogleBrowser = defaultController.withGoogleBrowser
export const retainGoogleBrowser = defaultController.retainGoogleBrowser

/** True when either a Brave connection is configured in Settings or a Chromium-family browser is installed. */
export async function hasGoogleBrowser(): Promise<boolean> {
  const existing = await new ExistingBrowserSettingsStore().read().catch(() => undefined)
  if (existing) return true
  return Boolean(await browserBinary())
}

// Signed-out redirects land on the account chooser for editor URLs, but on
// the marketing site for bare drive.google.com — treat both as signed out.
const LOGIN_HOSTS = ['accounts.google.com', 'accounts.youtube.com', 'workspace.google.com']

/** Does this URL mean Google bounced a signed-out visitor? */
export function isSignedOutUrl(url: string): boolean {
  return LOGIN_HOSTS.some((host) => url.includes(host))
}

async function waitForReattachedPage(context: BrowserContext, timeoutMs = 3000): Promise<Page | undefined> {
  const existing = context.pages().find((candidate) => !candidate.isClosed())
  if (existing) return existing
  if (typeof context.waitForEvent !== 'function') return undefined
  try {
    return await context.waitForEvent('page', {
      predicate: (candidate) => !candidate.isClosed(),
      timeout: timeoutMs,
    })
  } catch {
    return context.pages().find((candidate) => !candidate.isClosed())
  }
}

async function verifyGooglePageIdentity(page: Page, existing: boolean, account?: string): Promise<void> {
  if (isSignedOutUrl(page.url())) {
    const accountFlag = account ? ` --account ${account}` : ''
    throw new GoogleBrowserError(
      existing
        ? `Your connected Brave browser is signed out of Google. Sign in to Google in Brave, or run: sky google:browser${accountFlag}`
        : `Sky’s browser is signed out of Google. Run: sky google:browser${accountFlag}`,
    )
  }
  if (account) {
    const badge = page.locator('[aria-label^="Google Account:"]').first()
    if (await badge.isVisible().catch(() => false)) {
      const label = (await badge.getAttribute('aria-label').catch(() => null)) ?? ''
      if (label.includes('@') && !label.toLowerCase().includes(account.toLowerCase())) {
        throw new GoogleBrowserError(
          `Sky’s browser opened Google as a different account than ${account}. Sign in to ${account} in Sky’s browser (sky google:browser --account ${account}).`,
        )
      }
    }
  }
}

function alreadyOnRequestedDoc(currentUrl: string, targetUrl: string): boolean {
  try {
    const current = new URL(currentUrl)
    const target = new URL(targetUrl)
    if (current.origin !== target.origin || current.pathname !== target.pathname) return false
    if (!current.pathname.startsWith('/document/d/')) return false
    const requestedTab = target.searchParams.get('tab')
    const activeTab = current.searchParams.get('tab')
    if (requestedTab && activeTab && requestedTab !== activeTab) return false
    return true
  } catch {
    return false
  }
}

/** Open a Google URL on the owned browser page; throws when signed out or signed into the wrong account. */
export async function openGooglePage(
  target: Page | (Pick<GoogleBrowserSession, 'page' | 'existing'> & { context?: BrowserContext }),
  url: string,
  options: { account?: string; reuseLoadedDoc?: boolean } = {},
): Promise<Page> {
  let page = 'goto' in target ? target : target.page
  const existing = 'goto' in target ? false : target.existing
  const context = 'goto' in target ? undefined : target.context

  if (options.reuseLoadedDoc && !page.isClosed() && alreadyOnRequestedDoc(page.url(), url)) {
    await verifyGooglePageIdentity(page, existing, options.account)
    return page
  }

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  } catch (err) {
    if (!existing || !context || !page.isClosed()) throw err
    const reattached = await waitForReattachedPage(context)
    if (!reattached) throw err
    page = reattached
    await page.waitForLoadState?.('domcontentloaded', { timeout: 30_000 }).catch(() => undefined)
  }

  try {
    await page.waitForTimeout(4000)
  } catch (err) {
    if (!existing || !context || !page.isClosed()) throw err
    const reattached = await waitForReattachedPage(context)
    if (!reattached) throw err
    page = reattached
    await page.waitForLoadState?.('domcontentloaded', { timeout: 30_000 }).catch(() => undefined)
    await page.waitForTimeout(3000)
  }

  await verifyGooglePageIdentity(page, existing, options.account)
  return page
}
