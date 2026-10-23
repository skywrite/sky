/** A message's archive link, the form slack:follow:message takes; a reply names its thread root too. */
export function messageLink(workspace: string, channelId: string, ts: string, threadTs?: string): string {
  const base = `${workspace.replace(/\/$/, '')}/archives/${channelId}/p${ts.replace('.', '')}`
  return threadTs && threadTs !== ts ? `${base}?thread_ts=${threadTs}&cid=${channelId}` : base
}
