import { runCommand } from '#lib/sys/mod.ts'

export async function getSlackCredentials(
  workspaceUrl: string,
): Promise<{ token: string; cookie: string } | undefined> {
  const [tokenResult, cookieResult] = await Promise.all([
    runCommand('security', ['find-generic-password', '-s', 'agent-slack', '-a', `xoxc:${workspaceUrl}`, '-w']),
    runCommand('security', ['find-generic-password', '-s', 'agent-slack', '-a', 'xoxd', '-w']),
  ])
  if (tokenResult.code !== 0 || cookieResult.code !== 0) return undefined
  return { token: tokenResult.stdout.trim(), cookie: cookieResult.stdout.trim() }
}

/**
 * Call Slack's edge cache API (edgeapi.slack.com) on the same keychain creds —
 * lookups the classic API no longer serves under Enterprise Grid, e.g.
 * usergroups. `scopeId` picks the cache: the enterprise (E…) or a team (T…).
 * Edge successes carry no `ok` field; failures carry `ok: false`.
 */
export async function slackEdgeApiCall(
  workspaceUrl: string,
  scopeId: string,
  path: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const creds = await getSlackCredentials(workspaceUrl)
  if (!creds) return undefined
  try {
    const response = await fetch(`https://edgeapi.slack.com/cache/${scopeId}/${path}`, {
      method: 'POST',
      headers: {
        Cookie: `d=${encodeURIComponent(creds.cookie)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: creds.token, ...payload }),
      signal: AbortSignal.timeout(10_000),
    })
    const json = (await response.json()) as Record<string, unknown>
    return json.ok === false ? undefined : json
  } catch {
    return undefined
  }
}

export async function slackApiCall(
  workspaceUrl: string,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const creds = await getSlackCredentials(workspaceUrl)
  if (!creds) return undefined

  const serialized: Record<string, string> = { token: creds.token }
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    serialized[k] = typeof v === 'object' ? JSON.stringify(v) : String(v)
  }

  const formBody = new URLSearchParams(serialized)
  try {
    const response = await fetch(`${workspaceUrl}/api/${method}`, {
      method: 'POST',
      headers: {
        Cookie: `d=${encodeURIComponent(creds.cookie)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody,
      signal: AbortSignal.timeout(10_000),
    })
    const json = (await response.json()) as Record<string, unknown>
    return json.ok ? json : undefined
  } catch {
    return undefined
  }
}
