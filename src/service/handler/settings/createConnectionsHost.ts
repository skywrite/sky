import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { BEEPER_SYNC_STATE, type BeeperSyncOutcome } from '#commands/all/beeper/inbox/sync.ts'
import { reimportSlackFromBrave, slackAuthStatus, slackProfileName } from '#commands/all/slack/lib/authStatus.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import * as notebookConfig from '#config'
import { SLACK_WORKSPACE } from '#config'
import {
  type BeeperAccount,
  BeeperClient,
  BeeperError,
  beeperInfo,
  deleteBeeperGrant,
  grantExpired,
  isSlackAccount,
  loadBeeperGrant,
  loadBeeperSyncState,
  markKnown,
  networkOf,
  previewBeeper,
  reconcileAccountRules,
  saveBeeperGrant,
  saveBeeperSyncState,
  startBeeperSignIn,
} from '#lib/beeper/mod.ts'
import {
  buildAuthUrl,
  exchangeCode,
  fetchAccountEmail,
  generatePkce,
  GOOGLE_SCOPES,
  loadAccountTokens,
  loadAccountClient,
  loadDefaultClient,
  randomState,
  saveAccountTokens,
  startCloudSetup,
  startLoopback,
} from '#lib/google/mod.ts'
import type { CloudSetupRun } from '#lib/google/mod.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import { createSecret, updateEntry } from '#lib/secrets/marshal.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { isCommandAvailable } from '#lib/sys/mod.ts'
import { KNOWN_PROVIDERS } from '#shared/ai/models.ts'
import {
  checkPastedTypeSafeKey,
  checkTypeSafeKey,
  createTypeSafeClient,
  TYPESAFE_SECRET,
} from '#shared/ai/typesafe/client.ts'
import {
  type BeeperAccountRow,
  type BeeperConnectState,
  type BeeperStatus,
  type ConnectionsHost,
  type GoogleConnectState,
  type SlackStatus,
  tailOf,
  type TypeSafeStatus,
} from './connections.ts'
import { PROVIDER_LABEL } from './mod.ts'

/** A finished sign-in stays askable this long. */
const CONNECT_KEEP_MS = 10 * 60 * 1000

/**
 * Google's sign-in, run from the page the way `sky google:auth` runs it from
 * the terminal: a loopback receiver on this machine, the consent URL for the
 * browser, then the code exchanged and the account's tokens stored. The
 * browser has to be on this machine too — the redirect lands on 127.0.0.1.
 */
function googleSignIn(secrets: SecretsProvider): ConnectionsHost['google'] {
  const states = new Map<string, GoogleConnectState>()
  return {
    connection: (id) => states.get(id) ?? null,
    async connect(options = {}) {
      // An account connecting again keeps the pair that issued its grant; a new one takes the default.
      const own = options.email ? await loadAccountClient(secrets, options.email) : null
      const ownName = own && options.email ? (await loadAccountTokens(secrets, options.email))?.client : undefined
      const picked = own ? { name: ownName, client: own } : await loadDefaultClient(secrets)
      if (!picked) return null
      const { client } = picked
      const pkce = await generatePkce()
      const state = randomState()
      const loopback = await startLoopback(state)
      const url = buildAuthUrl({
        clientId: client.clientId,
        redirectUri: loopback.redirectUri,
        challenge: pkce.challenge,
        state,
        ...(options.email ? { loginHint: options.email } : {}),
      })
      const id = randomUUID()
      states.set(id, { status: 'waiting' })
      void (async () => {
        try {
          const code = await loopback.waitForCode()
          const tokens = await exchangeCode({
            client,
            code,
            verifier: pkce.verifier,
            redirectUri: loopback.redirectUri,
          })
          if (!tokens.refresh_token) throw new Error('Google returned no refresh token — try again')
          const email = await fetchAccountEmail(tokens.access_token)
          const previous = await loadAccountTokens(secrets, email)
          await saveAccountTokens(secrets, email, {
            refreshToken: tokens.refresh_token,
            accessToken: tokens.access_token,
            scopes: (tokens.scope ?? GOOGLE_SCOPES.join(' ')).split(' '),
            ...(picked.name && picked.name !== 'client' ? { client: picked.name } : {}),
            ...(previous?.setup ? { setup: previous.setup } : {}),
          })
          states.set(id, { status: 'done', email })
        } catch (err) {
          states.set(id, { status: 'failed', message: err instanceof Error ? err.message : String(err) })
        } finally {
          loopback.close()
          setTimeout(() => states.delete(id), CONNECT_KEEP_MS).unref()
        }
      })()
      return { id, url }
    },
    setup: googleSetup(secrets),
  }
}

/**
 * Sky's automated Google Cloud setup, run from the page: one window at a
 * time, its state polled by id. The finished run stays askable a while so
 * the page can show how it ended; the person's Continue and Cancel land on
 * the live run.
 */
function googleSetup(secrets: SecretsProvider): ConnectionsHost['google']['setup'] {
  const runs = new Map<string, CloudSetupRun>()
  let live: CloudSetupRun | null = null
  return {
    start(options = {}) {
      if (live) return null
      const run = startCloudSetup({ secrets, agreedToTerms: true, ...(options.tidy ? { tidyOnly: true } : {}) })
      live = run
      runs.set(run.id, run)
      void run.finished.finally(() => {
        if (live === run) live = null
        setTimeout(() => runs.delete(run.id), CONNECT_KEEP_MS).unref()
      })
      return { id: run.id }
    },
    state: (id) => runs.get(id)?.state() ?? null,
    continue(id) {
      const run = runs.get(id)
      if (!run) return false
      run.continue()
      return true
    },
    cancel(id) {
      const run = runs.get(id)
      if (!run) return false
      run.cancel()
      return true
    },
  }
}

async function slackStatus(): Promise<SlackStatus> {
  if (!(await isCommandAvailable('agent-slack'))) return { installed: false }
  const status = await slackAuthStatus()
  if (!status.ok) return { installed: true, ok: false, error: status.error }
  const workspace = status.url ?? SLACK_WORKSPACE ?? null
  const displayName = status.userId && workspace ? await slackProfileName(status.userId, workspace) : undefined
  return {
    installed: true,
    ok: true,
    workspace,
    team: status.team ?? null,
    user: status.user ?? null,
    displayName: displayName ?? null,
  }
}

async function slackReconnect(): Promise<SlackStatus> {
  if (!(await isCommandAvailable('agent-slack'))) return { installed: false }
  const imported = await reimportSlackFromBrave()
  if (!imported.ok) return { installed: true, ok: false, error: imported.error }
  return slackStatus()
}

/**
 * Beeper's sign-in, run from the page the way `sky beeper:auth` runs it from
 * the terminal: Sky registers itself with the desktop app, the approval page
 * opens in the browser, and the grant lands in the keychain. A token made in
 * Beeper's own settings is accepted too.
 */
function beeperConnection(
  secrets: SecretsProvider,
  stateFile: string,
  runCheck: () => Promise<BeeperSyncOutcome | null>,
): ConnectionsHost['beeper'] {
  const states = new Map<string, BeeperConnectState>()

  /** Beeper's accounts as rows, with the rules from the state file; rules for accounts seen the first time are written. */
  const rows = async (accounts: BeeperAccount[]): Promise<BeeperAccountRow[]> => {
    const state = await loadBeeperSyncState(stateFile)
    if (reconcileAccountRules(state, accounts)) await saveBeeperSyncState(stateFile, state)
    return accounts
      .filter((account) => !isSlackAccount(account))
      .map((account) => {
        const rule = state.accounts[account.accountID]
        const network = networkOf(account)
        return {
          id: account.accountID,
          network,
          status: account.status ?? 'unknown',
          save: rule?.save ?? false,
          groups: rule?.groups ?? false,
          holdUnknown: rule?.holdUnknown ?? true,
          chosen: rule?.chosen ?? false,
          chats: Object.values(state.chats).filter((chat) => chat.network === network).length,
        }
      })
  }

  /** The grant and the running app, or why the page cannot go further. */
  const ready = async (): Promise<BeeperClient | null> => {
    const grant = await loadBeeperGrant(secrets)
    if (!grant || grantExpired(grant) || !(await beeperInfo())) return null
    return new BeeperClient(grant.token)
  }

  return {
    async status() {
      const info = await beeperInfo()
      const grant = await loadBeeperGrant(secrets)
      const state = await loadBeeperSyncState(stateFile)
      const base: BeeperStatus = {
        running: Boolean(info),
        ...(info?.app?.version ? { version: info.app.version } : {}),
        connected: Boolean(grant),
        accounts: [],
        ...(state.lastRun ? { lastRun: state.lastRun } : {}),
        held: Object.entries(state.held)
          .map(([chat, entry]) => ({ chat, ...entry }))
          .sort((a, b) => b.at.localeCompare(a.at)),
      }
      if (!grant) return base
      if (grantExpired(grant))
        return { ...base, expired: true, ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}) }
      const known: BeeperStatus = { ...base, ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}) }
      if (!info) return known
      try {
        return { ...known, accounts: await rows(await new BeeperClient(grant.token).accounts()) }
      } catch (error) {
        if (error instanceof BeeperError && error.kind === 'unauthorized') return { ...known, expired: true }
        return { ...known, error: error instanceof Error ? error.message : 'Beeper could not list its accounts.' }
      }
    },
    async rule(id, change) {
      const state = await loadBeeperSyncState(stateFile)
      const rule = state.accounts[id]
      if (!rule) return false
      if (change.save !== undefined) rule.save = change.save
      if (change.groups !== undefined) rule.groups = change.groups
      if (change.holdUnknown !== undefined) rule.holdUnknown = change.holdUnknown
      rule.chosen = true
      await saveBeeperSyncState(stateFile, state)
      return true
    },
    async preview() {
      const client = await ready()
      if (!client) return null
      const state = await loadBeeperSyncState(stateFile)
      const preview = await previewBeeper({ client, state, now: new Date().toISOString() })
      await saveBeeperSyncState(stateFile, state)
      return preview
    },
    async keep(chat) {
      const state = await loadBeeperSyncState(stateFile)
      if (!markKnown(state, chat)) return false
      await saveBeeperSyncState(stateFile, state)
      return true
    },
    async open(chat) {
      const client = await ready()
      if (!client) return null
      return (await client.focus({ chatID: chat })).success
    },
    async check() {
      const outcome = await runCheck()
      if (!outcome) return { ran: false, reason: 'The check could not run.' }
      if ('unavailable' in outcome) return { ran: false, reason: outcome.unavailable }
      return {
        ran: true,
        chats: outcome.chats,
        messages: outcome.messages,
        files: outcome.files.length,
        complete: outcome.complete,
      }
    },
    async connect() {
      if (!(await beeperInfo())) return null
      const signIn = await startBeeperSignIn()
      const id = randomUUID()
      states.set(id, { status: 'waiting' })
      void (async () => {
        try {
          const grant = await signIn.finish()
          await saveBeeperGrant(secrets, grant)
          states.set(id, { status: 'done', ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}) })
        } catch (err) {
          states.set(id, { status: 'failed', message: err instanceof Error ? err.message : String(err) })
        } finally {
          setTimeout(() => states.delete(id), CONNECT_KEEP_MS).unref()
        }
      })()
      return { id, url: signIn.url }
    },
    connection: (id) => states.get(id) ?? null,
    async token(token) {
      try {
        const info = await new BeeperClient(token).tokenInfo()
        await saveBeeperGrant(secrets, { token, source: 'pasted', ...(info.scope ? { scope: info.scope } : {}) })
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Beeper did not accept the token.' }
      }
    },
    disconnect: () => deleteBeeperGrant(secrets),
  }
}

/**
 * TypeSafe's key, the way `sky secrets:set typesafe main` stores it — except
 * that the page asks TypeSafe first, so a mistyped key never lands. Every
 * look at the page asks again with the stored key, so a revoked key reads
 * as refused instead of failing the first call that needs it.
 */
function typesafeConnection(secrets: SecretsProvider): ConnectionsHost['typesafe'] {
  const { category, name } = TYPESAFE_SECRET
  return {
    async status() {
      const entry = await secrets.get(category, name)
      const key = entry?.type === 'secret' ? entry.val : entry?.type === 'login' ? entry.pass : ''
      if (!key) return { connected: false, models: [] }
      const tail = tailOf(key)
      const check = await checkTypeSafeKey(createTypeSafeClient({ secrets }))
      const stored: TypeSafeStatus = {
        connected: true,
        ...(tail ? { tail } : {}),
        models: check.ok ? check.models : [],
      }
      if (check.ok) return stored
      return { ...stored, ...(check.refused ? { refused: true } : {}), error: check.message }
    },
    async key(key) {
      const check = await checkPastedTypeSafeKey(key)
      if (!check.ok) return { ok: false, message: check.message }
      const existing = await secrets.get(category, name)
      await secrets.set(
        category,
        name,
        existing?.type === 'secret' ? updateEntry(existing, { val: key }) : createSecret(key),
      )
      return { ok: true }
    },
    disconnect: () => secrets.delete(category, name),
  }
}

/** Connections over the real machine: the keychain, the model providers, agent-slack, Google's, Beeper's and TypeSafe's keys. */
export function createConnectionsHost(): ConnectionsHost {
  const secrets = new KeychainSecretsProvider()
  // Check now runs the same command the heartbeat runs, in this process.
  const runCheck = async (): Promise<BeeperSyncOutcome | null> => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
    )
    const result = await new CommandService(CommandContext.server(notebookConfig, env)).run('beeper:inbox:sync', {})
    if (result.status !== 'success') throw new Error(result.message ?? 'The check failed.')
    return result.data ?? null
  }
  return {
    secrets,
    providers: () => KNOWN_PROVIDERS.map((id) => ({ id, label: PROVIDER_LABEL[id] ?? id })),
    google: googleSignIn(secrets),
    slack: { status: slackStatus, reconnect: slackReconnect },
    beeper: beeperConnection(secrets, BEEPER_SYNC_STATE, runCheck),
    typesafe: typesafeConnection(secrets),
  }
}
