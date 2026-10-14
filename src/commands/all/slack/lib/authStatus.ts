import {
  type AgentSlackAuthStatus,
  type AgentSlackUser,
  parseAuthTest,
} from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { runAgentSlack, slackConnection } from './agentSlack.ts'

/** What a Brave re-import needs; shown when one fails. */
export const IMPORT_REQUIREMENTS = [
  'Importing browser credentials requires:',
  '  - Brave running with a logged-in Slack tab for your workspace',
  '  - Brave: View → Developer → Allow JavaScript from Apple Events enabled',
  'Using another browser? Run agent-slack auth import-chrome / import-firefox / import-desktop directly.',
].join('\n')

/** `agent-slack auth test` against the configured workspace — agent-slack's default one when none is set. */
export async function slackAuthStatus(workspace = SLACK_WORKSPACE): Promise<AgentSlackAuthStatus> {
  const args = ['auth', 'test', ...(workspace ? ['--workspace', workspace] : [])]
  const result = await runAgentSlack(args)
  return result.issue
    ? { ok: false, error: result.stderr, ...result.issue }
    : parseAuthTest(result.stdout, result.stderr)
}

/** The signed-in person's profile name; auth.test's user field may be an old account handle. */
export async function slackProfileName(
  userId: string,
  workspace: string,
  run: (args: string[]) => Promise<{ success: boolean; stdout: string }> = runAgentSlack,
): Promise<string | undefined> {
  try {
    const result = await run(['user', 'get', userId, '--workspace', workspace])
    if (!result.success) return undefined
    const user = JSON.parse(result.stdout) as AgentSlackUser & { id?: string }
    if (user.id !== userId) return undefined
    return user.display_name?.trim() || user.real_name?.trim() || undefined
  } catch {
    return undefined
  }
}

/** Deliberate recovery: restore saved access first; import Brave only for missing/expired tokens. */
export async function restoreSlackAccess(workspace?: string): Promise<AgentSlackAuthStatus> {
  const result = await slackConnection.recover(workspace)
  return result.issue
    ? { ok: false, error: result.stderr, ...result.issue }
    : parseAuthTest(result.stdout, result.stderr)
}
