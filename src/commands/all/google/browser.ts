import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { signInGoogleBrowser } from '#lib/google/browserSignIn.ts'

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:browser': { params: Record<never, never>; result: Record<never, never> }
  }
}

export default class GoogleBrowserTask extends Command {
  static override description: CommandDescription = {
    name: 'google:browser',
    description: 'Sign in to Sky’s Google browser for Calendar, Zoom and document automation.',
    descriptionLong: [
      'Opens the dedicated browser profile shared with the meeting card’s Sign in to Google button.',
      'Sign in to Google in the window. Sky verifies the session, saves it and closes the window.',
      'This browser session is separate from the API connection made by google:auth.',
      'Re-run whenever the browser session expires.',
    ],
    usage: ['sky google:browser'],
    params: {},
  }

  async run({ context }: CommandArgs<Record<never, never>>): Promise<CommandResult<Record<never, never>>> {
    try {
      context.output.log('Opening Sky’s Google browser…')
      await signInGoogleBrowser({
        signal: context.signal,
        onOpened: () =>
          context.output.log(
            'Sign in to Google in the window. Sky will verify and save the session, then close the window.',
          ),
      })
      context.output.log('Signed in — session verified and saved.')
      return CommandResult.success({})
    } catch (error) {
      return CommandResult.fail(error instanceof Error ? error.message : 'Google sign-in could not finish.')
    }
  }
}
