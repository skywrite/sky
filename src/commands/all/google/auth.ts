import * as p from '@clack/prompts'
import open from 'open'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import {
  AccountResolutionError,
  GOOGLE_SCOPES,
  buildAuthUrl,
  deleteAccountTokens,
  exchangeCode,
  fetchAccountEmail,
  generatePkce,
  listAccountEmails,
  loadAccountTokens,
  loadOAuthClient,
  randomState,
  resolveAccountEmail,
  saveAccountTokens,
  saveOAuthClient,
  startLoopback,
} from '#lib/google/mod.ts'

const params = {
  list: Flag.bool('List authorized accounts', { short: 'l', default: false }),
  remove: Flag.string('Remove a stored account (email or unique part of it)'),
  setup: Flag.bool('Print the one-time Google Cloud walkthrough', { default: false }),
  print: Flag.bool('Print the authorization URL instead of opening the browser', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { email?: string; accounts?: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:auth': { params: Params; result: Result }
  }
}

const SETUP_WALKTHROUGH = `
One-time Google Cloud setup (~10 minutes, once ever)

  1. https://console.cloud.google.com — create a project (e.g. "sky")
  2. APIs & Services > Library — enable four APIs:
     Google Drive API, Google Docs API, Google Sheets API, Google Slides API
  3. APIs & Services > OAuth consent screen — External, app name "sky",
     your email. Save. Skip every optional field; add no scopes here.
  4. Publish the app to Production (testing status expires refresh tokens
     after 7 days).
  5. Credentials > Create credentials > OAuth client ID — type "Desktop app".
  6. Run sky google:auth and paste the client ID and secret when prompted.
     They are stored in the OS keychain (google/client), never in files.

Authorizing an account shows Google's "unverified app" warning once —
Advanced > Continue is expected for your own client. Repeat sky google:auth
for each additional Google account.
`

export default class GoogleAuthTask extends Command {
  static override description: CommandDescription = {
    name: 'google:auth',
    description: 'Authorize a Google account for Docs/Sheets/Slides/Drive access.',
    descriptionLong: [
      'Runs the OAuth installed-app flow (loopback + PKCE) against your own',
      'Google Cloud OAuth client. Everything lands in the OS keychain: the',
      'client pair as google/client, per-account tokens under the account',
      'email. Run once per account; tokens refresh silently afterwards.',
    ],
    usage: [
      'sky google:auth',
      'sky google:auth --list',
      'sky google:auth --remove jane@example.com',
      'sky google:auth --setup',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context

    if (args.setup) {
      output.log(SETUP_WALKTHROUGH)
      return CommandResult.success({})
    }

    if (args.list) {
      const accounts = await listAccountEmails(secrets)
      if (accounts.length === 0) {
        output.log('No Google accounts authorized yet. Run: sky google:auth')
        return CommandResult.success({ accounts })
      }
      for (const email of accounts) {
        const tokens = await loadAccountTokens(secrets, email)
        const scopeCount = tokens ? `${tokens.scopes.length} scopes` : 'unreadable entry'
        output.log(`${email}  (${scopeCount})`)
      }
      return CommandResult.success({ accounts })
    }

    if (args.remove) {
      let email: string
      try {
        email = resolveAccountEmail({ requested: args.remove, stored: await listAccountEmails(secrets) })
      } catch (err) {
        if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
        throw err
      }
      await deleteAccountTokens(secrets, email)
      output.log(`Removed ${email} from the keychain.`)
      output.log('To revoke the grant itself: https://myaccount.google.com/permissions')
      return CommandResult.success({ email })
    }

    let client = await loadOAuthClient(secrets)
    if (!client) {
      output.log('\nNo OAuth client stored yet (keychain entry google/client).')
      output.log('Need one? Walkthrough: sky google:auth --setup\n')
      const clientId = await p.text({ message: 'OAuth client ID:' })
      if (p.isCancel(clientId) || !clientId.trim()) return CommandResult.fail('Cancelled')
      const clientSecret = await p.password({ message: 'OAuth client secret:' })
      if (p.isCancel(clientSecret) || !clientSecret.trim()) return CommandResult.fail('Cancelled')
      client = { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
      await saveOAuthClient(secrets, client)
      output.log('  Stored the OAuth client in the keychain (google/client)')
    }

    const pkce = await generatePkce()
    const state = randomState()
    const loopback = await startLoopback(state)
    try {
      const authUrl = buildAuthUrl({
        clientId: client.clientId,
        redirectUri: loopback.redirectUri,
        challenge: pkce.challenge,
        state,
      })
      output.log(args.print ? '\nOpen this URL to authorize:' : '\nOpening Google authorization in your browser…')
      output.log(`  ${authUrl}\n`)
      if (!args.print) await open(authUrl)

      const code = await loopback.waitForCode()
      const tokens = await exchangeCode({
        client,
        code,
        verifier: pkce.verifier,
        redirectUri: loopback.redirectUri,
      })
      if (!tokens.refresh_token) {
        return CommandResult.error('Google returned no refresh token — run sky google:auth again')
      }

      const email = await fetchAccountEmail(tokens.access_token)
      await saveAccountTokens(secrets, email, {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        scopes: (tokens.scope ?? GOOGLE_SCOPES.join(' ')).split(' '),
      })
      output.log(`  Authorized ${email} — tokens stored in the keychain (google/${email})`)
      return CommandResult.success({ email })
    } catch (err) {
      return CommandResult.error(err instanceof Error ? err.message : String(err))
    } finally {
      loopback.close()
    }
  }
}
