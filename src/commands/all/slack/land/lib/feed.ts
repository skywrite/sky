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

/** How a conversation is read: its history newer than a ts, and one thread whole. */
export type ConversationReader = {
  history: (oldest: string) => Promise<AgentSlackMessage[]>
  thread: (root: string) => Promise<AgentSlackMessage[]>
}

/** Slack's answer for a thread whose root was deleted since its activity named it */
const GONE = /\b(thread_not_found|message_not_found)\b/

/**
 * A conversation's messages newer than `oldest`, with the new replies of
 * every thread that moved: a root in the history whose latest reply is
 * newer, and each thread named in `threads`. A reply under an older message
 * never shows in the history, so the threads Slack's activity names are
 * read too. Only messages newer than `oldest` come back, an older root
 * included: it was landed with its day, and that day is not rewritten.
 * Oldest first.
 */
export async function readConversation(
  reader: ConversationReader,
  oldest: string,
  threads: readonly string[] = [],
): Promise<AgentSlackMessage[]> {
  const history = await reader.history(oldest)
  const messages = new Map(history.map((message) => [message.ts, message]))
  const moved = history
    .filter((root) => root.latest_reply && compareTs(root.latest_reply, oldest) > 0)
    .map((root) => root.ts)
  for (const root of new Set([...moved, ...threads])) {
    let thread: AgentSlackMessage[]
    try {
      thread = await reader.thread(root)
    } catch (error) {
      if (GONE.test(error instanceof Error ? error.message : String(error))) continue
      throw error
    }
    for (const message of thread) if (compareTs(message.ts, oldest) > 0) messages.set(message.ts, message)
  }
  return [...messages.values()].sort((a, b) => compareTs(a.ts, b.ts))
}

/** A conversation's new messages and thread replies from Slack, files downloaded for the day. */
export function listConversation(
  workspace: string,
  channelId: string,
  oldest: string,
  threads: readonly string[] = [],
): Promise<AgentSlackMessage[]> {
  return readConversation(
    {
      history: (from) => listChannelHistory(workspace, channelId, from, { downloads: true }),
      thread: (root) => listThread(workspace, channelId, root, { downloads: true }),
    },
    oldest,
    threads,
  )
}
