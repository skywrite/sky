import { slackApiCall } from '#commands/all/slack/lib/slack-api.ts'
import { readRules, type SlackRules } from './rules.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/** Slack stores current mutes in notification preferences; older workspaces use a comma-separated list. */
export function slackMutedChannels(prefs: Record<string, unknown>): string[] {
  const muted = new Set(
    typeof prefs.muted_channels === 'string'
      ? prefs.muted_channels
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : [],
  )
  const raw = prefs.all_notifications_prefs
  let decoded: unknown = raw
  if (typeof raw === 'string') {
    try {
      decoded = JSON.parse(raw)
    } catch {
      throw new Error('Slack returned unreadable notification preferences. Check the Slack connection and try again.')
    }
  }
  const notifications = record(decoded)
  if (raw !== undefined && !notifications) throw new Error('Slack returned unreadable notification preferences.')
  for (const [id, value] of Object.entries(record(notifications?.channels) ?? {})) {
    const channel = record(value)
    if (channel?.muted === true) muted.add(id)
    else if (channel?.muted === false) muted.delete(id)
  }
  return [...muted]
}

/** A mute in either Slack or Sky excludes the channel. An unavailable preference read must not enable channels. */
export async function readEffectiveSlackRules(
  file: string,
  workspace: string | undefined,
  api: typeof slackApiCall = slackApiCall,
): Promise<SlackRules> {
  const rules = await readRules(file)
  if (!workspace) return rules
  const response = await api(workspace, 'users.prefs.get', {})
  const prefs = record(response?.prefs)
  if (!prefs) {
    throw new Error('Could not read your Slack channel mutes. Check the Slack connection in Settings and try again.')
  }
  return { muted: [...new Set([...rules.muted, ...slackMutedChannels(prefs)])] }
}
