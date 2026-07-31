import * as p from '@clack/prompts'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { GoogleBrowserError, isSignedOutUrl, launchGoogleBrowser } from './lib/browserSession.ts'

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:browser': { params: Record<never, never>; result: Record<never, never> }
  }
}

export default class GoogleBrowserTask extends Command {
  static override description: CommandDescription = {
    name: 'google:browser',
    description: 'Sign in to the Google automation browser (one time) — enables anchored comments.',
    descriptionLong: [
      'Opens the dedicated automation browser profile. Sign in to Google in',
      'the window, then close it; the session persists in the profile and',
      'the workspace agent uses it for what the API cannot do (comments',
      'anchored to a slide or cell). Re-run whenever the session expires.',
    ],
    usage: ['sky google:browser'],
    params: {},
  }

  async run({ context }: CommandArgs<Record<never, never>>): Promise<CommandResult<Record<never, never>>> {
    const { output } = context

    let browserContext
    try {
      browserContext = await launchGoogleBrowser({ headless: false })
    } catch (err) {
      if (err instanceof GoogleBrowserError) return CommandResult.fail(err.message)
      throw err
    }

    let browserClosed = false
    browserContext.on('close', () => {
      browserClosed = true
    })

    // Straight to the sign-in form (bare drive.google.com bounces signed-out
    // visitors to a marketing page); continue lands on Drive when done.
    const page = browserContext.pages()[0] ?? (await browserContext.newPage())
    await page
      .goto('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fdrive.google.com', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      .catch(() => undefined)

    output.log('A browser window opened. Sign in to Google there, then come back to this terminal.')

    for (;;) {
      const done = await p.confirm({ message: 'Signed in? sky will verify and save the session.' })
      if (p.isCancel(done) || !done) {
        await browserContext.close().catch(() => undefined)
        return CommandResult.fail('Cancelled — run sky google:browser again anytime.')
      }
      if (browserClosed) {
        return CommandResult.fail(
          'The browser window closed before the session could be verified (a Brave self-update restart does this). Run sky google:browser again.',
        )
      }
      const verifyPage = browserContext.pages()[0] ?? (await browserContext.newPage())
      await verifyPage
        .goto('https://drive.google.com', { waitUntil: 'domcontentloaded', timeout: 30_000 })
        .catch(() => undefined)
      await verifyPage.waitForTimeout(2500)
      if (!isSignedOutUrl(verifyPage.url())) {
        await browserContext.close()
        output.log('Signed in — session verified and saved.')
        return CommandResult.success({})
      }
      output.log('Still signed out (Google bounced to the sign-in page) — finish signing in, then confirm again.')
    }
  }
}
