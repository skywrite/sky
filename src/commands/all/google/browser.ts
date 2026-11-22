import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { signInGoogleBrowser } from '#lib/google/browserSignIn.ts'

const params = {
  account: Flag.string('Google account email to verify (optional)', { short: 'a' }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:browser': { params: Params; result: Record<never, never> }
  }
}

export default class GoogleBrowserTask extends Command {
  static override description: CommandDescription = {
    name: 'google:browser',
    description: 'Sign in to Google in Sky’s browser for Calendar, Zoom and document automation.',
    descriptionLong: [
      'Opens Sky’s shared browser connection (your connected Brave profile when enabled in',
      'Settings → Browser automation, otherwise Sky’s persistent browser profile).',
      'Sign in to Google in the window. Sky verifies the session, saves it and closes the window.',
      'This browser session is shared with the meeting card, browser tasks, and anchored document comments.',
    ],
    usage: ['sky google:browser', 'sky google:browser --account jane@example.com'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Record<never, never>>> {
    try {
      context.output.log('Opening Sky’s browser for Google sign-in…')
      await signInGoogleBrowser({
        account: args.account?.trim() || undefined,
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
