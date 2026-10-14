import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { DIR_STATE, SLACK_WORKSPACE } from '#config'
import { KeychainAccess } from '#lib/secrets/keychainAccess.ts'
import { runCommand } from '#lib/sys/mod.ts'
import { calendarInstant, instantNow } from '#universal/dates/nbdt/mod.ts'
import { SlackConnection, type SlackCredentialConfig, type SlackCommandResult } from './connection.ts'
import { runProtectedSlack } from './protectedProcess.ts'

// Upstream agent-slack defaults fail fast — a 30s process watchdog and
// immediate rate-limit (429) errors — tuned for interactive agent use where a
// hang is worse than a failure. Sky drives it unattended (attachment
// downloads inside message get, background follow checks), where patience is
// correct: raise the ceilings unless the environment already sets them.
const ENV_DEFAULTS: Record<string, string> = {
  AGENT_SLACK_COMMAND_TIMEOUT_MS: '120000',
  AGENT_SLACK_RATE_LIMIT_MAX_WAIT_MS: '30000',
}

/** Env for agent-slack children: sky's unattended-use defaults, with environment overrides winning. */
export function agentSlackEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(ENV_DEFAULTS)) {
    env[key] = process.env[key] ?? value
  }
  return env
}

const keychain = new KeychainAccess(path.join(DIR_STATE, 'keychain'))

export const slackConnection = new SlackConnection({
  stateDir: path.join(DIR_STATE, 'slack', 'connection'),
  configuredWorkspace: SLACK_WORKSPACE,
  macOS: process.platform === 'darwin',
  now: () => calendarInstant(instantNow()),
  async config() {
    let contents: string
    try {
      contents = await readFile(path.join(homedir(), '.config', 'agent-slack', 'credentials.json'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { workspaces: [] }
      throw error
    }
    const config = JSON.parse(contents) as SlackCredentialConfig
    if (
      !Array.isArray(config.workspaces) ||
      config.workspaces.some(
        (workspace) =>
          typeof workspace.workspace_url !== 'string' || !['browser', 'standard'].includes(workspace.auth?.auth_type),
      )
    )
      throw new Error('Invalid Slack credential configuration.')
    return config
  },
  secret: (account, interactive) => keychain.get('agent-slack', account, interactive),
  restoreKeychain: () => keychain.restore(),
  run: (args, credentials) => runProtectedSlack(args, credentials, agentSlackEnv()),
  // The sole unrestricted launch is a deliberate browser import. No token is
  // passed in argv or copied to Sky's configuration, logs or pause state.
  importBrave: () =>
    runCommand('agent-slack', ['auth', 'import-brave'], {
      env: { ...agentSlackEnv(), AGENT_SLACK_KEYCHAIN_TIMEOUT_MS: '120000', AGENT_SLACK_NO_UPDATE_CHECK: '1' },
      timeout: 180_000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
    }),
})

/** Every ordinary Slack operation is noninteractive, including Settings checks. */
export function runAgentSlack(args: string[]): Promise<SlackCommandResult> {
  return slackConnection.run(args)
}
