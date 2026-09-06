import { randomUUID } from 'node:crypto'
import { reimportSlackFromBrave, slackAuthStatus } from '#commands/all/slack/lib/authStatus.ts'
import { SLACK_WORKSPACE } from '#config'
import {
  buildAuthUrl,
  exchangeCode,
  fetchAccountEmail,
  generatePkce,
  GOOGLE_SCOPES,
  loadOAuthClient,
  randomState,
  saveAccountTokens,
  startLoopback,
} from '#lib/google/mod.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { isCommandAvailable } from '#lib/sys/mod.ts'
import { KNOWN_PROVIDERS } from '#shared/ai/models.ts'
import type { ConnectionsHost, GoogleConnectState, SlackStatus } from './connections.ts'
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
    async connect() {
      const client = await loadOAuthClient(secrets)
      if (!client) return null
      const pkce = await generatePkce()
      const state = randomState()
      const loopback = await startLoopback(state)
      const url = buildAuthUrl({
        clientId: client.clientId,
        redirectUri: loopback.redirectUri,
        challenge: pkce.challenge,
        state,
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
          await saveAccountTokens(secrets, email, {
            refreshToken: tokens.refresh_token,
            accessToken: tokens.access_token,
            scopes: (tokens.scope ?? GOOGLE_SCOPES.join(' ')).split(' '),
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
  }
}

async function slackStatus(): Promise<SlackStatus> {
  if (!(await isCommandAvailable('agent-slack'))) return { installed: false }
  const status = await slackAuthStatus()
  if (!status.ok) return { installed: true, ok: false, error: status.error }
  return {
    installed: true,
    ok: true,
    workspace: status.url ?? SLACK_WORKSPACE ?? null,
    team: status.team ?? null,
    user: status.user ?? null,
  }
}

async function slackReconnect(): Promise<SlackStatus> {
  if (!(await isCommandAvailable('agent-slack'))) return { installed: false }
  const imported = await reimportSlackFromBrave()
  if (!imported.ok) return { installed: true, ok: false, error: imported.error }
  return slackStatus()
}

/** Connections over the real machine: the keychain, the model providers, agent-slack, Google's sign-in. */
export function createConnectionsHost(): ConnectionsHost {
  const secrets = new KeychainSecretsProvider()
  return {
    secrets,
    providers: () => KNOWN_PROVIDERS.map((id) => ({ id, label: PROVIDER_LABEL[id] ?? id })),
    google: googleSignIn(secrets),
    slack: { status: slackStatus, reconnect: slackReconnect },
  }
}
