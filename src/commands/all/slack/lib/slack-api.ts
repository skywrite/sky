import { slackConnection } from './agentSlack.ts'
import type { SlackCredentials } from './connection.ts'

export async function getSlackCredentials(
  workspaceUrl: string,
): Promise<(SlackCredentials & { cookie: string }) | undefined> {
  try {
    const credentials = await slackConnection.credentials(workspaceUrl)
    return { ...credentials, cookie: credentials.cookie ?? '' }
  } catch {
    return undefined
  }
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
    if (json.ok === false && /^(invalid_auth|token_expired|token_revoked|not_authed)$/.test(String(json.error)))
      await slackConnection.reportFailure(creds, 'expired')
    else if (response.status === 429) await slackConnection.reportFailure(creds, 'network')
    return json.ok === false ? undefined : json
  } catch {
    await slackConnection.reportFailure(creds, 'network').catch(() => {})
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
    const response = await fetch(`${creds.workspace}/api/${method}`, {
      method: 'POST',
      headers: {
        Cookie: `d=${encodeURIComponent(creds.cookie)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody,
      signal: AbortSignal.timeout(10_000),
    })
    const json = (await response.json()) as Record<string, unknown>
    if (json.ok === false && /^(invalid_auth|token_expired|token_revoked|not_authed)$/.test(String(json.error)))
      await slackConnection.reportFailure(creds, 'expired')
    else if (response.status === 429) await slackConnection.reportFailure(creds, 'network')
    return json.ok ? json : undefined
  } catch {
    await slackConnection.reportFailure(creds, 'network').catch(() => {})
    return undefined
  }
}
