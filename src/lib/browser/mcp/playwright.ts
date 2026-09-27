import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { DIR_CODE_SRC, DIR_HOME } from '#config'
import { clearProfileLock, NoBrowserError, quietProfilePreferences } from '../persistentContext.ts'
import { browserBinary, clearDownloadBookkeeping } from './browserDriver.ts'
import { McpClient } from './client.ts'

// The browser server is Playwright's own MCP server, shipped inside the
// playwright package Sky already pins: `playwright mcp`. Running it from
// Sky's node_modules keeps the browser tools at Sky's Playwright version
// with no second copy and no separate release to track.

/**
 * Sky's browser profile: the person signs in once and every task after
 * reuses the session. It lives under ~/.sky like the Google profiles —
 * local to this Mac, never inside synced data.
 */
export const SKY_BROWSER_PROFILE_DIR = path.join(DIR_HOME, '.sky', 'browser-profile')

const PLAYWRIGHT_CLI = path.join(DIR_CODE_SRC, 'node_modules', 'playwright', 'cli.js')
/** Preloaded into the server so an error outside a tool call cannot end it; see serverGuard.ts. */
const SERVER_GUARD = new URL('./serverGuard.ts', import.meta.url).pathname

/**
 * A site's bot wall reads the browser's own tells. Playwright adds switches
 * a person's browser never carries; the ones that leave a mark on what a
 * page can observe are dropped here, and `AutomationControlled` is
 * disabled so `navigator.webdriver` reads false the way it does for anyone.
 * Nothing is spoofed: a masked property is itself a tell. The viewport is
 * left to the window, so the screen, its scale and the window size agree.
 */
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

export interface PlaywrightMcpOptions {
  /** Downloads and screenshots land here */
  outputDir: string
  /** The run's own files: the server config */
  runDir: string
  profileDir?: string
  headless?: boolean
  /** A particular browser binary; otherwise the first installed Chromium-family browser */
  executablePath?: string
  onStderr?: (line: string) => void
}

/** Start the browser server on Sky's profile. The browser itself opens on the first tool call. */
export async function launchPlaywrightMcp(options: PlaywrightMcpOptions): Promise<McpClient> {
  const executablePath = options.executablePath ?? (await browserBinary())
  if (!executablePath) throw new NoBrowserError()
  const profileDir = options.profileDir ?? SKY_BROWSER_PROFILE_DIR

  await mkdir(profileDir, { recursive: true })
  // The profile is this feature's alone: a browser left behind by a crashed
  // run is an orphan, so take the profile back rather than fail the launch.
  await clearProfileLock(profileDir, true)
  await quietProfilePreferences(profileDir)
  await clearDownloadBookkeeping(profileDir)
  await mkdir(options.outputDir, { recursive: true })
  await mkdir(options.runDir, { recursive: true })

  const configFile = path.join(options.runDir, 'mcp-config.json')
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
        outputDir: options.outputDir,
      },
      null,
      2,
    ),
  )

  return McpClient.start({
    command: process.execPath,
    args: [
      '--preload',
      SERVER_GUARD,
      PLAYWRIGHT_CLI,
      'mcp',
      '--config',
      configFile,
      '--caps',
      'vision',
      '--image-responses',
      'allow',
      // Action results carry no snapshot; the model looks with browser_snapshot,
      // which keeps the files folder to downloads and screenshots.
      '--snapshot-mode',
      'none',
    ],
    // The server names files relative to its working directory: a download
    // reads as its bare name, which read_file and save_file resolve.
    cwd: options.outputDir,
    clientName: 'sky',
    onStderr: options.onStderr,
  })
}
