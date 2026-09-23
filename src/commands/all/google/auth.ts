import * as p from '@clack/prompts'
import open from 'open'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import {
  APP_NAME,
  AccountResolutionError,
  GOOGLE_CLOUD_SETUP_STEPS,
  GOOGLE_SCOPES,
  GOOGLE_UNVERIFIED_APP_NOTE,
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
  startCloudSetup,
  startLoopback,
} from '#lib/google/mod.ts'
import type { CloudSetupState, SetupPhaseKey } from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'

const params = {
  list: Flag.bool('List authorized accounts', { short: 'l', default: false }),
  remove: Flag.string('Remove a stored account (email or unique part of it)'),
  setup: Flag.bool('Let Sky set up the Google Cloud side in a browser, then sign in', { default: false }),
  manual: Flag.bool('Print the console walkthrough and paste a client of your own', { default: false }),
  print: Flag.bool('Print the authorization URL instead of opening the browser', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { email?: string; accounts?: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:auth': { params: Params; result: Result }
  }
}

const SETUP_WALKTHROUGH = [
  '',
  'One-time Google Cloud setup by hand (~10 minutes, once ever)',
  '',
  ...GOOGLE_CLOUD_SETUP_STEPS.map((step, index) => `  ${index + 1}. ${step}`),
  `  ${GOOGLE_CLOUD_SETUP_STEPS.length + 1}. Paste the client ID and secret below.`,
  '     They are stored in the OS keychain (google/client), never in files.',
  '',
  GOOGLE_UNVERIFIED_APP_NOTE,
  'Repeat sky google:auth for each additional Google account.',
  '',
].join('\n')

const TERMS_NOTE = [
  '',
  'Sky opens a window for you to sign in, then sets up the Google Cloud side itself:',
  `a private project, the APIs Sky uses, an app named "${APP_NAME}", and its key — about two minutes.`,
  "On your behalf it agrees to Google Cloud's Terms of Service and the API Services User Data Policy:",
  '  https://cloud.google.com/terms',
  '  https://developers.google.com/terms/api-services-user-data-policy',
  '',
].join('\n')

export default class GoogleAuthTask extends Command {
  static override description: CommandDescription = {
    name: 'google:auth',
    description: 'Connect a Google account for Mail, Calendar, Drive and Docs.',
    descriptionLong: [
      'Runs the OAuth installed-app flow (loopback + PKCE). With no client',
      'stored, Sky sets up the Google Cloud side in a browser window first —',
      'or pastes one of your own with --manual. Everything lands in the OS',
      'keychain: the client pairs as google/client and google/client:<project>,',
      'per-account tokens under the account email. Tokens refresh silently.',
    ],
    usage: [
      'sky google:auth',
      'sky google:auth --setup',
      'sky google:auth --manual',
      'sky google:auth --list',
      'sky google:auth --remove jane@example.com',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context

    if (args.list) {
      const accounts = await listAccountEmails(secrets)
      if (accounts.length === 0) {
        output.log('No Google accounts connected yet. Run: sky google:auth')
        return CommandResult.success({ accounts })
      }
      for (const email of accounts) {
        const tokens = await loadAccountTokens(secrets, email)
        const scopeCount = tokens ? `${tokens.scopes.length} scopes` : 'unreadable entry'
        const made = tokens?.setup ? `, set up by sky in ${tokens.setup.projectId}` : ''
        output.log(`${email}  (${scopeCount}${made})`)
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
    if (args.setup || (!client && !args.manual)) {
      if (!client && !args.setup) {
        output.log('\nNo Google Cloud client stored yet — Sky can make one for you.')
        output.log('To paste a client of your own instead: sky google:auth --manual')
      }
      return runSetup(output, secrets)
    }

    if (!client) {
      output.log(SETUP_WALKTHROUGH)
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

/**
 * The automated setup, printed as it goes: each step as it starts and
 * finishes, the two moments the window needs the person, and — when Sky
 * could not do a step — the written step with a Continue prompt.
 */
async function runSetup(output: OutputHandler, secrets: SecretsProvider): Promise<CommandResult<Result>> {
  output.log(TERMS_NOTE)
  const agreed = await p.confirm({ message: 'Go ahead?' })
  if (p.isCancel(agreed) || !agreed) return CommandResult.fail('Cancelled')

  const run = startCloudSetup({ secrets, agreedToTerms: true })
  const printed = new Map<SetupPhaseKey, string>()
  let lastWait = ''
  const report = (state: CloudSetupState) => {
    for (const step of state.steps) {
      if (step.state === 'todo' || printed.get(step.key) === step.state) continue
      printed.set(step.key, step.state)
      output.log(step.state === 'doing' ? `◦ ${step.label}…` : `  ✓ ${step.label}`)
    }
    if (state.needsYou && !state.needsYou.instruction && state.needsYou.message !== lastWait) {
      lastWait = state.needsYou.message
      output.log(`  → ${state.needsYou.message}`)
    }
  }
  report(run.state())
  const unsubscribe = run.onChange(report)

  // A step Sky could not do is the person's; Continue asks Sky to look again.
  const askContinue = async (state: CloudSetupState) => {
    const wait = state.needsYou
    if (!wait?.instruction) return
    output.log(`\n  ${wait.message}`)
    output.log(`  How: ${wait.instruction}\n`)
    const done = await p.confirm({ message: 'Done — should Sky look again?' })
    if (p.isCancel(done) || !done) run.cancel()
    else run.continue()
  }
  let asking: Promise<void> = Promise.resolve()
  const unsubscribeAsk = run.onChange((state) => {
    if (state.needsYou?.instruction) asking = asking.then(() => askContinue(state))
  })

  try {
    const final = await run.finished
    await asking
    if (final.status === 'done' && final.email) {
      output.log(`\nConnected ${final.email} — tokens stored in the keychain (google/${final.email})`)
      return CommandResult.success({ email: final.email })
    }
    return CommandResult.fail(final.message ?? 'The setup did not finish')
  } finally {
    unsubscribe()
    unsubscribeAsk()
  }
}
