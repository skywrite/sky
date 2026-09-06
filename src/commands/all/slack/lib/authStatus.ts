import { type AgentSlackAuthStatus, parseAuthTest } from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { runAgentSlack } from './agentSlack.ts'

/** What a Brave re-import needs; shown when one fails. */
export const IMPORT_REQUIREMENTS = [
  'Importing browser credentials requires:',
  '  - Brave running with a logged-in Slack tab for your workspace',
  '  - Brave: View → Developer → Allow JavaScript from Apple Events enabled',
  'Using another browser? Run agent-slack auth import-chrome / import-firefox / import-desktop directly.',
].join('\n')

/** `agent-slack auth test` against the configured workspace — agent-slack's default one when none is set. */
export async function slackAuthStatus(): Promise<AgentSlackAuthStatus> {
  const args = ['auth', 'test', ...(SLACK_WORKSPACE ? ['--workspace', SLACK_WORKSPACE] : [])]
  const result = await runAgentSlack(args)
  return parseAuthTest(result.stdout, result.stderr)
}

/** Fresh browser-session tokens from a logged-in Slack tab in Brave. */
export async function reimportSlackFromBrave(): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const imported = await runAgentSlack(['auth', 'import-brave'])
  if (!imported.success) {
    const detail = (imported.stderr.trim() || imported.stdout.trim() || `exit code ${imported.code}`).trim()
    return { ok: false, error: `agent-slack auth import-brave failed: ${detail}\n${IMPORT_REQUIREMENTS}` }
  }
  return { ok: true, output: imported.stdout.trim() }
}
