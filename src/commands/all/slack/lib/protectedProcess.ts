import { runCommand } from '#lib/sys/mod.ts'
import type { SlackCommandResult, SlackCredentials } from './connection.ts'

// The third-party loader consults Keychain even with SLACK_TOKEN set. Deny both
// its security subprocess and native Keychain IPC in the child and descendants.
// Never fall back to an unrestricted launch if macOS rejects this profile.
export const SLACK_SANDBOX_PROFILE = `(version 1)
(allow default)
(deny process-exec (literal "/usr/bin/security"))
(deny mach-lookup
  (global-name "com.apple.SecurityServer")
  (global-name "com.apple.securityd.xpc")
  (global-name "com.apple.security.agent"))
(deny appleevent-send)`

export function runProtectedSlack(
  args: string[],
  credentials: SlackCredentials,
  env: Record<string, string>,
  platform = process.platform,
  run = runCommand,
): Promise<SlackCommandResult> {
  const childEnv = {
    ...env,
    SLACK_TOKEN: credentials.token,
    SLACK_COOKIE_D: credentials.cookie ?? '',
    SLACK_COOKIE: '',
    SLACK_WORKSPACE_URL: credentials.workspace,
    AGENT_SLACK_NO_UPDATE_CHECK: '1',
  }
  return platform === 'darwin'
    ? run('/usr/bin/sandbox-exec', ['-p', SLACK_SANDBOX_PROFILE, '/usr/bin/env', 'agent-slack', ...args], {
        env: childEnv,
        timeout: 150_000,
        killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024 * 1024,
      })
    : run('agent-slack', args, { env: childEnv, timeout: 150_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 })
}
