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
    })
    const json = (await response.json()) as Record<string, unknown>
    return json.ok ? json : undefined
  } catch {
    return undefined
  }
}
