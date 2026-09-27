import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as net from 'node:net'
import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { DIR_CODE_SRC, DIR_HOME } from '#config'
import { isProcessAlive, withProcessLock } from '#lib/jobs/files.ts'
import { exists } from '#shared/fs/mod.ts'
import { clearProfileLock, findChromiumBrowser, NoBrowserError, quietProfilePreferences } from '../persistentContext.ts'
import { McpClient } from './client.ts'

// Sky's browser: one profile holding every sign-in, one long-lived driver
// — Playwright's MCP server serving over HTTP — started once and left
// running with its window open, and a tab of its own for each task. A task
// attaches for its length and lets go; the tab stays where it was for the
// person, or closes when the task is done; the window and its sign-ins
// stay for the next task. Five tasks at once are five tabs.

export const SKY_BROWSER_DIR = path.join(DIR_HOME, '.sky', 'browser')

const PLAYWRIGHT_CLI = path.join(DIR_CODE_SRC, 'node_modules', 'playwright', 'cli.js')
const SERVER_GUARD = new URL('./serverGuard.ts', import.meta.url).pathname
const START_TIMEOUT_MS = 20_000

/** Playwright's own switches that leave a mark on what a page can observe. */
const AUTOMATION_SWITCHES = [
  '--enable-automation',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-popup-blocking',
  '--disable-sync',
  '--disable-background-networking',
  '--disable-client-side-phishing-detection',
  '--force-color-profile=srgb',
]

export interface BrowserDriver {
  dir: string
  profileDir: string
  /** Where the driver puts downloads; a task moves its own out */
  downloadsDir: string
  /** The MCP endpoint */
  url: string
  pid: number
}

interface DriverRecord {
  pid: number
  port: number
  startedAt: string
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>)\]]+/

/** The first web address in a task, if it names one. */
export function firstUrl(text: string): string | undefined {
  return text.match(URL_IN_TEXT)?.[0]
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })

/** Whether a driver answers at this endpoint: any HTTP reply will do, a refused connection will not. */
async function listening(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(1500),
    })
    await response.body?.cancel()
    return true
  } catch {
    return false
  }
}

const endpoint = (port: number): string => `http://localhost:${port}/mcp`

async function readRecord(dir: string): Promise<DriverRecord | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, 'driver.json'), 'utf8')) as DriverRecord
  } catch {
    return null
  }
}

/**
 * Sky's browser binary: Playwright's own Chromium when it is installed —
 * the build Playwright is tested against, so downloads do not bring it
 * down — else the first installed Chromium-family browser. Brave crashed
 * on its main thread after downloads, four times on 2026-09-27 alone.
 */
export async function browserBinary(): Promise<string | null> {
  const bundled = chromium.executablePath()
  if (bundled && (await exists(bundled))) return bundled
  return findChromiumBrowser()
}

/** A browser's download bookkeeping, which a crash leaves corrupt and which Brave then crashes on again. */
export async function clearDownloadBookkeeping(profileDir: string): Promise<void> {
  await rm(path.join(profileDir, 'Default', 'Download Service'), { recursive: true, force: true })
}

export interface BrowserDriverOptions {
  /** Where the browser lives; the default is ~/.sky/browser */
  root?: string
  headless?: boolean
  executablePath?: string
}

/** Sky's browser driver, running: the one already up, or a fresh one. */
export async function ensureBrowserDriver(options: BrowserDriverOptions = {}): Promise<BrowserDriver> {
  const dir = options.root ?? SKY_BROWSER_DIR
  const profileDir = path.join(dir, 'profile')
  const downloadsDir = path.join(dir, 'downloads')
  await mkdir(profileDir, { recursive: true })
  await mkdir(downloadsDir, { recursive: true })

  return withProcessLock(path.join(dir, 'launch.lock'), async () => {
    const known = await readRecord(dir)
    if (known && isProcessAlive(known.pid) && (await listening(endpoint(known.port)))) {
      return { dir, profileDir, downloadsDir, url: endpoint(known.port), pid: known.pid }
    }
    // Nothing answers: whatever holds the profile is an orphan of a crashed driver.
    await clearProfileLock(profileDir, true)
    await quietProfilePreferences(profileDir)
    await clearDownloadBookkeeping(profileDir)
    const executablePath = options.executablePath ?? (await browserBinary())
    if (!executablePath) throw new NoBrowserError()

    const configFile = path.join(dir, 'driver-config.json')
    await writeFile(
      configFile,
      JSON.stringify(
        {
          browser: {
            userDataDir: profileDir,
            launchOptions: {
              executablePath,
              headless: options.headless ?? false,
              chromiumSandbox: true,
              ignoreDefaultArgs: AUTOMATION_SWITCHES,
              args: ['--disable-blink-features=AutomationControlled'],
            },
            contextOptions: { viewport: null },
          },
          outputDir: downloadsDir,
        },
        null,
        2,
      ),
    )
    const port = await freePort()
    const log = openSync(path.join(dir, 'driver.log'), 'a')
    const child = spawn(
      process.execPath,
      [
        '--preload',
        SERVER_GUARD,
        PLAYWRIGHT_CLI,
        'mcp',
        '--config',
        configFile,
        '--port',
        String(port),
        '--host',
        'localhost',
        // Every task's client shares the profile's one context, each in its own tab.
        '--shared-browser-context',
        '--caps',
        'vision',
        '--image-responses',
        'allow',
        // Action results carry no snapshot; the driver looks with browser_snapshot.
        '--snapshot-mode',
        'none',
      ],
      // Its own process group: a task killed at the terminal does not take it along.
      { cwd: downloadsDir, detached: true, stdio: ['ignore', log, log] },
    )
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
    const record: DriverRecord = { pid: child.pid!, port, startedAt: new Date().toISOString() }
    await writeFile(path.join(dir, 'driver.json'), JSON.stringify(record, null, 2))
    const deadline = Date.now() + START_TIMEOUT_MS
    while (!(await listening(endpoint(port)))) {
      if (!isProcessAlive(record.pid))
        throw new Error(`The browser driver stopped while starting; see ${path.join(dir, 'driver.log')}`)
      if (Date.now() > deadline) throw new Error(`The browser driver did not start within ${START_TIMEOUT_MS / 1000}s`)
      await delay(200)
    }
    return { dir, profileDir, downloadsDir, url: endpoint(port), pid: record.pid }
  })
}

/**
 * A client on Sky's browser, for one task, in a tab of its own. Closing the
 * client leaves the driver, the window and the tab up; `closeTab` first
 * when the task is done with it.
 */
export async function attachBrowserDriver(
  options: BrowserDriverOptions = {},
): Promise<{ client: McpClient; driver: BrowserDriver }> {
  const driver = await ensureBrowserDriver(options)
  const client = await McpClient.connect({ url: driver.url, clientName: 'sky' })
  const tab = await client.callTool('browser_tabs', { action: 'new' })
  if (tab.isError) {
    await client.close()
    const why = tab.content.map((part) => (part as { text?: string }).text ?? '').join(' ')
    throw new Error(`Sky's browser could not open a tab: ${why.slice(0, 200)}`)
  }
  return { client, driver }
}

/** The task's tab, closed; the window stays. */
export async function closeTab(client: McpClient): Promise<void> {
  await client.callTool('browser_tabs', { action: 'close' }).catch(() => undefined)
}
