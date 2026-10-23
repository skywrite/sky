import type { AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { agentSlackJson, listChannelHistory, listThread } from '#commands/all/slack/pull/lib/slack.ts'
import { compareTs } from '#commands/all/slack/pull/lib/ts.ts'

/** One entry of Slack's Activity view, as `agent-slack activity list --refs-only` prints it. */
export type ActivityEntry = { type: string; feed_ts: string; channel_id?: string; ts?: string; thread_ts?: string }

/** Activity newer than `since` (a ts), oldest first, entries without their messages. */
export async function listActivity(
  workspace: string,
  since: string,
  types: readonly string[],
  limit = 500,
): Promise<ActivityEntry[]> {
  const data = await agentSlackJson<{ items?: ActivityEntry[] }>(
    [
      'activity',
      'list',
      '--refs-only',
      '--since',
      since,
      '--types',
      types.join(','),
      '--limit',
      String(limit),
      '--workspace',
      workspace,
    ],
    'activity list',
  )
  return (data.items ?? []).filter((item) => item.feed_ts).sort((a, b) => compareTs(a.feed_ts, b.feed_ts))
}

/** One of the owner's own messages, as `agent-slack search messages` prints it. */
export type OwnMessage = { channel_id: string; ts: string; permalink?: string }

/** The owner's own messages from a day on, through Slack search; newest first as Slack returns them. */
export async function searchOwnMessages(
  workspace: string,
  userId: string,
  afterDay: string,
  limit = 200,
): Promise<OwnMessage[]> {
  const data = await agentSlackJson<{ messages?: OwnMessage[] }>(
    [
      'search',
      'messages',
      '',
      '--user',
      userId,
      '--after',
      afterDay,
      '--limit',
      String(limit),
      '--no-download',
      '--workspace',
      workspace,
    ],
    'search messages',
  )
  return (data.messages ?? []).filter((message) => message.channel_id && message.ts)
}

/**
 * A conversation's messages newer than `oldest`, files downloaded for the
 * day, with the replies of any thread that moved since; a moved thread's
 * root comes along for context. Oldest first.
 */
export async function listConversation(
  workspace: string,
  channelId: string,
  oldest: string,
): Promise<AgentSlackMessage[]> {
  const history = await listChannelHistory(workspace, channelId, oldest, { downloads: true })
  const messages = new Map(history.map((message) => [message.ts, message]))
  for (const root of history) {
    if (!root.latest_reply || compareTs(root.latest_reply, oldest) <= 0) continue
    for (const message of await listThread(workspace, channelId, root.ts, { downloads: true })) {
      if (message.ts === root.ts || compareTs(message.ts, oldest) > 0) messages.set(message.ts, message)
    }
  }
  return [...messages.values()].sort((a, b) => compareTs(a.ts, b.ts))
}
