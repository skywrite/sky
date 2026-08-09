import { type AgentSlackAuthStatus, parseAuthTest } from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { isCommandAvailable } from '#lib/sys/mod.ts'

const params = {
  check: Flag.bool('Only test credentials — skip the Brave re-import when they are invalid'),
}

type Params = InferParams<typeof params>

type Result = {
  ok: boolean
  repaired: boolean
  workspace?: string
  team?: string
  user?: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:auth': {
      params: Params
      result: Result
    }
  }
}

const IMPORT_REQUIREMENTS = [
  'Importing browser credentials requires:',
  '  - Brave running with a logged-in Slack tab for your workspace',
  '  - Brave: View → Developer → Allow JavaScript from Apple Events enabled',
  'Using another browser? Run agent-slack auth import-chrome / import-firefox / import-desktop directly.',
].join('\n')

export default class SlackAuthCommand extends Command {
  static override description: CommandDescription = {
    name: 'slack:auth',
    description: 'Check agent-slack credentials and re-import them from Brave when expired.',
    descriptionLong: [
      'Runs `agent-slack auth test` against the workspace configured as slack.workspace',
      '(set by sky init when it detects the agent-slack CLI).',
      'Slack browser-session tokens (xoxc/xoxd) expire every few months; when the test fails,',
      'this re-imports fresh tokens from a logged-in Slack tab via `agent-slack auth import-brave`.',
    ],
    usage: ['sky slack:auth', 'sky slack:auth --check'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context

    if (!(await isCommandAvailable('agent-slack'))) {
      return CommandResult.fail(
        'agent-slack CLI not found on PATH. Install it from https://github.com/stablyai/agent-slack, then re-run sky init.',
      )
    }

    if (!SLACK_WORKSPACE) {
      output.log('No slack.workspace in sky config — testing the agent-slack default workspace.')
      output.log('Set it via sky init, or add `"slack": { "workspace": "https://yourteam.slack.com" }` to the config.')
    }

    const status = await testAuth()
    if (status.ok) {
      logStatus(output, status, { repaired: false })
      return CommandResult.success({
        ok: true,
        repaired: false,
        workspace: status.url,
        team: status.team,
        user: status.user,
      })
    }

    if (args.check) {
      return CommandResult.fail(
        `Slack credentials invalid: ${status.error}. Run sky slack:auth (without --check) to re-import from Brave.`,
      )
    }

    output.log(`Slack credentials invalid (${status.error}) — re-importing from Brave...`)
    const imported = await runAgentSlack(['auth', 'import-brave'])
    if (!imported.success) {
      const detail = (imported.stderr.trim() || imported.stdout.trim() || `exit code ${imported.code}`).trim()
      return CommandResult.fail(`agent-slack auth import-brave failed: ${detail}\n${IMPORT_REQUIREMENTS}`)
    }
    if (imported.stdout.trim()) output.log(imported.stdout.trim())

    const retested = await testAuth()
    if (!retested.ok) {
      return CommandResult.fail(`Credentials still invalid after re-import: ${retested.error}\n${IMPORT_REQUIREMENTS}`)
    }

    logStatus(output, retested, { repaired: true })
    return CommandResult.success({
      ok: true,
      repaired: true,
      workspace: retested.url,
      team: retested.team,
      user: retested.user,
    })
  }
}

async function testAuth(): Promise<AgentSlackAuthStatus> {
  const testArgs = ['auth', 'test', ...(SLACK_WORKSPACE ? ['--workspace', SLACK_WORKSPACE] : [])]
  const result = await runAgentSlack(testArgs)
  return parseAuthTest(result.stdout, result.stderr)
}

function logStatus(
  output: { log: (message: string) => void },
  status: Extract<AgentSlackAuthStatus, { ok: true }>,
  opts: { repaired: boolean },
): void {
  output.log('')
  output.log(opts.repaired ? 'Slack auth OK (credentials re-imported)' : 'Slack auth OK')
  output.log(`  Workspace: ${status.url ?? SLACK_WORKSPACE ?? '(default)'}`)
  if (status.team) output.log(`  Team:      ${status.team}`)
  if (status.user) output.log(`  User:      ${status.user}`)
}
