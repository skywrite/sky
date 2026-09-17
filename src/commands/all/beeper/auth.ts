import open from 'open'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import {
  BeeperClient,
  BeeperError,
  beeperInfo,
  deleteBeeperGrant,
  grantExpired,
  loadBeeperGrant,
  saveBeeperGrant,
  startBeeperSignIn,
} from '#lib/beeper/mod.ts'

const params = {
  token: Flag.string('Store a token made in Beeper Desktop under Settings → Integrations instead of signing in'),
  remove: Flag.bool('Forget the stored connection', { default: false }),
  status: Flag.bool('Show the connection and the chat accounts Beeper has', { default: false }),
  print: Flag.bool('Print the approval URL instead of opening the browser', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { connected: boolean; accounts?: string[]; expiresAt?: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'beeper:auth': { params: Params; result: Result }
  }
}

export default class BeeperAuthTask extends Command {
  static override description: CommandDescription = {
    name: 'beeper:auth',
    description: 'Connect Sky to Beeper Desktop on this Mac.',
    descriptionLong: [
      'Beeper Desktop keeps every chat network on this Mac behind one local',
      'API. Signing in registers Sky with the app, opens its approval page,',
      'and stores the grant in the OS keychain (beeper/desktop). Beeper issues',
      'no refresh token, so an expired grant means signing in again.',
      'The desktop app must be running.',
    ],
    usage: [
      'sky beeper:auth',
      'sky beeper:auth --status',
      'sky beeper:auth --token <token>   # a token made in Beeper under Settings → Integrations',
      'sky beeper:auth --remove',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context

    if (args.remove) {
      await deleteBeeperGrant(secrets)
      output.log('Forgot the Beeper connection. Beeper itself still lists Sky under Settings → Integrations.')
      return CommandResult.success({ connected: false })
    }

    if (args.status) {
      const info = await beeperInfo()
      const grant = await loadBeeperGrant(secrets)
      if (!info) output.log('Beeper Desktop is not running.')
      else output.log(`Beeper Desktop ${info.app?.version ?? ''} is running.`)
      if (!grant) {
        output.log('Sky is not connected. Run: sky beeper:auth')
        return CommandResult.success({ connected: false })
      }
      if (grantExpired(grant)) {
        output.log(`The stored grant expired ${grant.expiresAt}. Run: sky beeper:auth`)
        return CommandResult.success({ connected: false, expiresAt: grant.expiresAt })
      }
      if (!info)
        return CommandResult.success({ connected: true, ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}) })
      try {
        const accounts = await new BeeperClient(grant.token).accounts()
        const names = accounts.map(
          (account) => `${account.network ?? account.accountID} (${account.status ?? 'unknown'})`,
        )
        output.log(names.length ? `Accounts: ${names.join(', ')}` : 'Beeper has no chat accounts yet.')
        if (grant.expiresAt) output.log(`Grant expires ${grant.expiresAt}.`)
        return CommandResult.success({
          connected: true,
          accounts: names,
          ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
        })
      } catch (error) {
        if (error instanceof BeeperError && error.kind === 'unauthorized') {
          output.log('Beeper no longer accepts the stored grant. Run: sky beeper:auth')
          return CommandResult.success({ connected: false })
        }
        throw error
      }
    }

    if (args.token) {
      const token = args.token.trim()
      try {
        const info = await new BeeperClient(token).tokenInfo()
        await saveBeeperGrant(secrets, { token, source: 'pasted', ...(info.scope ? { scope: info.scope } : {}) })
      } catch (error) {
        if (error instanceof BeeperError) return CommandResult.fail(error.message)
        throw error
      }
      output.log('Stored the Beeper token in the keychain (beeper/desktop).')
      return CommandResult.success({ connected: true })
    }

    if (!(await beeperInfo()))
      return CommandResult.fail('Beeper Desktop is not running. Open it, then run sky beeper:auth again.')
    let signIn
    try {
      signIn = await startBeeperSignIn()
    } catch (error) {
      if (error instanceof BeeperError) return CommandResult.fail(error.message)
      throw error
    }
    output.log(
      args.print ? '\nOpen this URL to approve Sky in Beeper:' : '\nOpening Beeper’s approval page in your browser…',
    )
    output.log(`  ${signIn.url}\n`)
    if (!args.print) await open(signIn.url)
    try {
      const grant = await signIn.finish()
      await saveBeeperGrant(secrets, grant)
      output.log('Connected. Stored the grant in the keychain (beeper/desktop).')
      if (grant.expiresAt) output.log(`It expires ${grant.expiresAt}; Sky will ask you to sign in again then.`)
      return CommandResult.success({ connected: true, ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}) })
    } catch (error) {
      if (error instanceof BeeperError) return CommandResult.fail(error.message)
      return CommandResult.fail(error instanceof Error ? error.message : 'The sign-in did not finish.')
    }
  }
}
