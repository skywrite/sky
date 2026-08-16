import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { GOOGLE_BROWSER_PROFILE_LOCK, GoogleBrowserError, launchGoogleBrowser } from './lib/browserSession.ts'
import { ProfileLockBusyError, acquireProfileLock } from './lib/profileLock.ts'

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:browser': { params: Record<never, never>; result: Record<never, never> }
  }
}

// Straight to the sign-in form (bare drive.google.com bounces signed-out
// visitors to a marketing page); the continue lands on Drive when done.
const SIGNIN_URL = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fdrive.google.com'

/** How often to look for a tab that landed on Drive. */
const POLL_MS = 3000

/** Drive bounces signed-out visitors within a beat — a tab still on Drive after this settle is signed in. */
const SETTLE_MS = 2500

/** Sign-in with 2FA takes minutes; a window forgotten open would hold the profile forever — bound it. */
const SIGNIN_DEADLINE_MS = 10 * 60_000

/** Hostname equality, not substring: the sign-in URL itself carries drive.google.com inside its continue param. */
function isDriveUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).hostname === 'drive.google.com'
  } catch {
    return false
  }
}

export default class GoogleBrowserTask extends Command {
  static override description: CommandDescription = {
    name: 'google:browser',
    description: 'Sign in to the Google automation browser (one time) — enables anchored comments.',
    descriptionLong: [
      'Opens the dedicated automation browser profile. Sign in to Google in',
      'the window; sky detects the completed sign-in, saves the session, and',
      'closes the window by itself. The workspace agent uses the session for',
      'what the API cannot do (comments anchored to a slide or cell). Re-run',
      'whenever the session expires.',
    ],
    usage: ['sky google:browser'],
    params: {},
  }

  async run({ context }: CommandArgs<Record<never, never>>): Promise<CommandResult<Record<never, never>>> {
    const { output } = context

    // Turn-taking with agent flows: launching without the cross-process lock
    // would smash into Chromium's SingletonLock mid-mission instead of
    // waiting out a warm agent browser, whose idle close frees the profile
    // well inside the wait deadline.
    let releaseLock: () => Promise<void>
    try {
      releaseLock = await acquireProfileLock(GOOGLE_BROWSER_PROFILE_LOCK, {
        onWait: () => output.log('The automation browser is busy in another sky process — waiting for it to finish…'),
      })
    } catch (err) {
      if (err instanceof ProfileLockBusyError) return CommandResult.fail(err.message)
      throw err
    }

    try {
      let browserContext
      try {
        browserContext = await launchGoogleBrowser({ headless: false, takeover: true })
      } catch (err) {
        if (err instanceof GoogleBrowserError) return CommandResult.fail(err.message)
        throw err
      }

      let browserClosed = false
      browserContext.once('close', () => {
        browserClosed = true
      })

      const page = browserContext.pages()[0] ?? (await browserContext.newPage())
      await page.goto(SIGNIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)

      output.log(
        'A browser window opened. Sign in to Google there — sky detects it, saves the session, and closes the window (Ctrl-C cancels).',
      )

      // The context can close mid-poll; a dead context has no Drive tab.
      const onDrive = () => {
        try {
          return browserContext.pages().some((tab) => isDriveUrl(tab.url()))
        } catch {
          return false
        }
      }

      for (let waitedMs = 0; waitedMs < SIGNIN_DEADLINE_MS; waitedMs += POLL_MS) {
        if (browserClosed) {
          return CommandResult.fail(
            'The browser window closed before the sign-in could be verified. Run sky google:browser again — a completed sign-in verifies instantly.',
          )
        }
        if (onDrive()) {
          await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
          if (!browserClosed && onDrive()) {
            await browserContext.close().catch(() => undefined)
            output.log('Signed in — session verified and saved.')
            return CommandResult.success({})
          }
          continue // bounced back off Drive (or the window closed) — the next tick decides
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }

      await browserContext.close().catch(() => undefined)
      return CommandResult.fail(
        `No completed sign-in after ${SIGNIN_DEADLINE_MS / 60_000} minutes — closed the browser. Run sky google:browser again.`,
      )
    } finally {
      await releaseLock()
    }
  }
}
