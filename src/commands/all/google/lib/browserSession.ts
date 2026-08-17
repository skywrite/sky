import { execFileSync } from 'node:child_process'
import { readlink, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import type { BrowserContext, Page } from 'playwright'
import { exists } from '#shared/fs/mod.ts'
import { acquireProfileLock, isProcessAlive } from './profileLock.ts'

// A dedicated persistent browser profile for Google UI automation. Google
// blocks CDP attachment to a browser's default profile (Chromium 136+), so
// the automation session lives in its own profile: the user signs in once
// via `sky google:browser`, and the cookies persist. This exists for the
// features Google's APIs refuse to expose — e.g. anchored comments.

export const GOOGLE_BROWSER_PROFILE_DIR = path.join(os.homedir(), '.sky', 'google-browser-profile')

/** Cross-process turn-taking lock (see profileLock.ts) — beside the profile, not inside Chromium's dir. */
export const GOOGLE_BROWSER_PROFILE_LOCK = path.join(os.homedir(), '.sky', 'google-browser-profile.lock')

export const CHROMIUM_PATHS = [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

export async function findChromiumBrowser(): Promise<string | null> {
  for (const binary of CHROMIUM_PATHS) {
    if (await exists(binary)) return binary
  }
  return null
}

export class GoogleBrowserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleBrowserError'
  }
}

/** Pid named by the profile's Chromium SingletonLock, if any. */
async function profileLockPid(): Promise<number | null> {
  try {
    const target = await readlink(path.join(GOOGLE_BROWSER_PROFILE_DIR, 'SingletonLock'))
    const pid = Number.parseInt(target.split('-').pop() ?? '', 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

async function removeSingletonFiles(): Promise<void> {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    await rm(path.join(GOOGLE_BROWSER_PROFILE_DIR, name), { force: true }).catch(() => undefined)
  }
}

/** Full command line of a pid, or null when it cannot be read (usually: it just died). */
function commandLineOf(pid: number): string | null {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
  } catch {
    return null
  }
}

/**
 * SIGKILL a wedged headless automation browser. Proof before force: the
 * pid's command line must name our profile dir (so it is our automation
 * Chromium, not an unrelated process that reused the pid) AND carry
 * --headless (so it is never the visible `sky google:browser` sign-in
 * window). Returns false when nothing can be safely killed.
 */
function killWedgedProfileBrowser(pid: number): boolean {
  const command = commandLineOf(pid)
  if (command === null || !command.includes(GOOGLE_BROWSER_PROFILE_DIR) || !command.includes('--headless')) {
    return false
  }
  try {
    process.kill(pid, 'SIGKILL')
    return true
  } catch {
    return false
  }
}

/**
 * Chromium refuses to start on a profile whose SingletonLock names another
 * process. Classify the named pid by its command line before acting: dead —
 * or alive but not on our profile dir (pid reuse after a crash) — means the
 * lock is stale, so self-heal it. A live holder on our profile dir is real
 * contention. With takeover, a HEADLESS one is killed as a wedged leftover:
 * cooperating flows serialize on the cross-process profile lock, so nothing
 * legitimate can still be squatting here. The visible `sky google:browser`
 * sign-in window (headed) is never killed — it closes itself once sign-in
 * verifies, so the error points there instead of at kill.
 */
async function clearProfileLockOrThrow(options: { takeover?: boolean } = {}): Promise<void> {
  const pid = await profileLockPid()
  if (pid !== null && isProcessAlive(pid)) {
    const command = commandLineOf(pid) ?? ''
    if (command.includes(GOOGLE_BROWSER_PROFILE_DIR)) {
      const killed = options.takeover === true && killWedgedProfileBrowser(pid)
      if (!killed) {
        throw new GoogleBrowserError(
          command.includes('--headless')
            ? `The automation profile is in use by a headless automation browser (pid ${pid}) — kill ${pid}, then retry`
            : `A sky google:browser sign-in window is open on the automation profile (pid ${pid}) — finish signing in there (the window closes itself once verified), or close it, then retry`,
        )
      }
      // Give the killed process a beat to die before clearing its files.
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  await removeSingletonFiles()
}

/** Launches that lose a Chromium startup race hang, not fail — bound them. */
const LAUNCH_TIMEOUT_MS = 60_000

/** Launch the persistent automation profile. Callers must close() the context. */
export async function launchGoogleBrowser(
  options: { headless?: boolean; takeover?: boolean } = {},
): Promise<BrowserContext> {
  const executablePath = await findChromiumBrowser()
  if (!executablePath) {
    throw new GoogleBrowserError('No Chromium-family browser found for automation')
  }
  await clearProfileLockOrThrow({ takeover: options.takeover })
  const launch = () =>
    chromium.launchPersistentContext(GOOGLE_BROWSER_PROFILE_DIR, {
      executablePath,
      headless: options.headless ?? false,
      viewport: { width: 1440, height: 900 },
      timeout: LAUNCH_TIMEOUT_MS,
      // Playwright defaults the Chromium sandbox OFF (--no-sandbox); this
      // profile renders third-party-shared docs, so keep the sandbox up.
      chromiumSandbox: true,
    })
  let context: BrowserContext
  try {
    context = await launch()
  } catch (err) {
    // A not-quite-dead predecessor wedges the launch to its deadline. Kill
    // it — headless on our profile only — and try once more.
    const pid = await profileLockPid()
    if (!options.takeover || pid === null || !killWedgedProfileBrowser(pid)) throw err
    await new Promise((resolve) => setTimeout(resolve, 500))
    await removeSingletonFiles()
    context = await launch()
  }
  // Session debris: crashed runs leave their tabs in the profile's session
  // state, and the restore makes pages()[0] targeting ambiguous (and buried
  // the google:browser sign-in form under 62 tabs once). Any tab present at
  // launch belongs to a dead session — one browser per profile — so start on
  // a single tab. Best-effort: late-restoring tabs drain on later launches.
  for (const page of context.pages().slice(1)) await page.close().catch(() => undefined)
  return context
}

// Chromium allows one process per profile dir, so concurrent flows collide:
// the loser throws on the SingletonLock or, losing the startup race, hangs
// in launch. Agent missions DO issue browser tool calls concurrently (the
// AI SDK runs a step's tool calls in parallel) — queue whole flows instead
// of letting them fight.
let profileQueue: Promise<unknown> = Promise.resolve()

/**
 * The launch → close boundary between consecutive flows is both the wedge
 * surface (rapid relaunch on a persistent profile can hang Chromium) and
 * ~20s of overhead per anchored comment. So the browser stays WARM between
 * flows: one launch serves a whole mission, and an idle timer folds the
 * session — and releases the cross-process lock — shortly after the last
 * call. Other sky processes wait on the lock up to 120s; the 90s idle close
 * frees it inside their window.
 */
const WARM_IDLE_MS = 90_000

/**
 * Hard ceiling per flow, between the slowest legitimate flow (an anchored
 * comment ≈ 90s) and the agent's 180s tool timer. A wedged page operation
 * gets its browser closed from under it so the queue advances — instead of
 * every queued call timing out behind it in turn.
 */
const FLOW_DEADLINE_MS = 150_000

interface WarmBrowser {
  context: BrowserContext
  release: () => Promise<void>
  headless: boolean
  closed: boolean
  idleTimer?: ReturnType<typeof setTimeout>
}

let warm: WarmBrowser | null = null

async function closeWarmBrowser(): Promise<void> {
  const session = warm
  warm = null
  if (!session) return
  clearTimeout(session.idleTimer)
  // close() can hang on a wedged browser — bound it; the takeover path in
  // the next launch cleans up whatever survives.
  await Promise.race([
    session.context.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ])
  await session.release()
}

/** Run one browser flow with exclusive use of the automation profile. */
export async function withGoogleBrowser<T>(
  options: { headless?: boolean },
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const run = profileQueue.then(async () => {
    const headless = options.headless ?? false
    if (warm && (warm.closed || warm.headless !== headless)) await closeWarmBrowser()
    let session = warm
    if (session) {
      clearTimeout(session.idleTimer)
    } else {
      // Turn-taking across sky processes; within this process the queue
      // already serializes, so the lock is uncontended here. Held while the
      // browser stays warm.
      const release = await acquireProfileLock(GOOGLE_BROWSER_PROFILE_LOCK)
      try {
        const context = await launchGoogleBrowser({ headless, takeover: true })
        const created: WarmBrowser = { context, release, headless, closed: false }
        context.once('close', () => {
          created.closed = true
        })
        session = created
        warm = created
      } catch (err) {
        await release()
        throw err
      }
    }
    const active = session
    let deadlineHit = false
    const deadline = setTimeout(() => {
      deadlineHit = true
      void closeWarmBrowser()
    }, FLOW_DEADLINE_MS)
    try {
      return await fn(active.context)
    } catch (err) {
      if (deadlineHit) {
        throw new GoogleBrowserError(
          `The browser flow exceeded ${FLOW_DEADLINE_MS / 1000}s and was force-closed — the next call starts a fresh browser`,
        )
      }
      throw err
    } finally {
      clearTimeout(deadline)
      if (warm === active && !active.closed) {
        // Park warm. The teardown rides the queue, so it can never close the
        // browser under a flow that grabbed the queue first; unref lets a
        // one-shot CLI process exit without serving the idle window.
        active.idleTimer = setTimeout(() => {
          profileQueue = profileQueue
            .then(() => (warm === active ? closeWarmBrowser() : undefined))
            .catch(() => undefined)
        }, WARM_IDLE_MS)
        ;(active.idleTimer as unknown as { unref?: () => void }).unref?.()
      } else if (warm === active) {
        // The context died mid-flow — release the lock now rather than idle.
        await closeWarmBrowser()
      }
    }
  })
  profileQueue = run.catch(() => undefined)
  return await run
}

// Signed-out redirects land on the account chooser for editor URLs, but on
// the marketing site for bare drive.google.com — treat both as signed out.
const LOGIN_HOSTS = ['accounts.google.com', 'accounts.youtube.com', 'workspace.google.com']

/** Does this URL mean Google bounced a signed-out visitor? */
export function isSignedOutUrl(url: string): boolean {
  return LOGIN_HOSTS.some((host) => url.includes(host))
}

/** Open a Google URL in the automation profile; throws when the profile is signed out. */
export async function openGooglePage(context: BrowserContext, url: string): Promise<Page> {
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(4000)
  if (isSignedOutUrl(page.url())) {
    throw new GoogleBrowserError('The automation browser is signed out of Google. Run: sky google:browser')
  }
  return page
}
