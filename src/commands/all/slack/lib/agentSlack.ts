import { runCommand } from '#lib/sys/mod.ts'

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

/** Spawn the agent-slack CLI with sky's unattended-use environment defaults. */
export function runAgentSlack(args: string[]): ReturnType<typeof runCommand> {
  return runCommand('agent-slack', args, { env: agentSlackEnv() })
}
