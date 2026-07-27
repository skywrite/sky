/**
 * Parsers for `agent-slack auth` output.
 *
 * `auth test` prints a JSON object (`{ok: true, url, team, user, ...}`) on
 * success and a bare error line like `invalid_auth` on failure.
 * `auth whoami` prints the local credential config as JSON.
 */

export type AgentSlackAuthStatus =
  | { ok: true; url?: string; team?: string; user?: string }
  | { ok: false; error: string }

export function parseAuthTest(stdout: string, stderr: string): AgentSlackAuthStatus {
  try {
    const parsed = JSON.parse(stdout) as { ok?: boolean; url?: string; team?: string; user?: string; error?: string }
    if (parsed.ok) return { ok: true, url: parsed.url, team: parsed.team, user: parsed.user }
    return { ok: false, error: parsed.error || stdout.trim() || 'unknown_error' }
  } catch {
    return { ok: false, error: stdout.trim() || stderr.trim() || 'unknown_error' }
  }
}

export type AgentSlackWhoami = {
  defaultWorkspaceUrl?: string
  workspaceUrls: string[]
}

export function parseWhoami(stdout: string): AgentSlackWhoami | undefined {
  try {
    const parsed = JSON.parse(stdout) as {
      default_workspace_url?: string
      workspaces?: { workspace_url?: string }[]
    }
    const workspaceUrls = (parsed.workspaces ?? []).map((w) => w.workspace_url).filter((u): u is string => !!u)
    return { defaultWorkspaceUrl: parsed.default_workspace_url, workspaceUrls }
  } catch {
    return undefined
  }
}
