import type { AgentSlackAuthStatus } from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import { restoreSlackAccess, slackAuthStatus } from '#commands/all/slack/lib/authStatus.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { isCommandAvailable } from '#lib/sys/mod.ts'

const params = {
  check: Flag.bool('Check saved access without authentication prompts or browser imports'),
  workspace: Flag.string('Workspace URL or saved name; defaults to the configured workspace'),
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

export default class SlackAuthCommand extends Command {
  static override description: CommandDescription = {
    name: 'slack:auth',
    description: 'Restore Slack access; import from Brave only when the saved session is missing or expired.',
    descriptionLong: [
      'Checks the saved credentials without displaying authentication prompts against slack.workspace',
      '(set by sky init when it detects the agent-slack CLI).',
      'Without --check, explicitly restores macOS Keychain access if needed.',
      'Imports fresh tokens from a logged-in Slack tab in Brave only when the saved session is missing or expired.',
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

    if (!args.workspace && !SLACK_WORKSPACE) {
      output.log('No slack.workspace in sky config — testing the agent-slack default workspace.')
      output.log('Set it via sky init, or add `"slack": { "workspace": "https://yourteam.slack.com" }` to the config.')
    }

    const status = await slackAuthStatus(args.workspace)
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
      return CommandResult.fail(`${status.error} Run sky slack:auth (without --check) to restore access.`)
    }

    output.log(
      'Restoring Slack access. macOS may request your login password; Brave is used only if the saved session needs refreshing.',
    )
    const retested = await restoreSlackAccess(args.workspace)
    if (!retested.ok) {
      return CommandResult.fail(retested.error)
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

function logStatus(
  output: { log: (message: string) => void },
  status: Extract<AgentSlackAuthStatus, { ok: true }>,
  opts: { repaired: boolean },
): void {
  output.log('')
  output.log(opts.repaired ? 'Slack auth OK (access restored)' : 'Slack auth OK')
  output.log(`  Workspace: ${status.url ?? SLACK_WORKSPACE ?? '(default)'}`)
  if (status.team) output.log(`  Team:      ${status.team}`)
  if (status.user) output.log(`  User:      ${status.user}`)
}
