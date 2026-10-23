/**
 * The agent-slack calls the pull makes, shared with the landing. Every read
 * goes through the fork's CLI; the pull lists files without downloading them,
 * the landing downloads them for the day; bodies come back whole.
 */
import type { AgentSlackConversationCount, AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import { oneLine } from '#commands/all/slack/lib/mod.ts'
import { compareTs } from './ts.ts'

/** conversations.history returns at most this many messages per call. */
const PAGE = 200

export async function agentSlackJson<T>(args: string[], what: string): Promise<T> {
  const result = await runAgentSlack(args)
  if (!result.success) {
    const detail = result.stderr.trim() || result.stdout.trim()
    const hint = detail.includes('invalid_auth')
      ? ' — credentials expired, run `sky slack:auth`'
      : /unknown option '--(counts-only|no-downloads)'/.test(detail)
        ? ' — this agent-slack predates the channel pull; update its checkout (git pull)'
        : ''
    throw new Error(`agent-slack ${what} failed: ${oneLine(detail, 300)}${hint}`)
  }
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throw new Error(`agent-slack ${what} printed something other than JSON: ${oneLine(result.stdout, 200)}`)
  }
}

/** Every joined conversation with the ts of its newest channel message: one client.counts call. */
export async function listJoinedConversations(workspace: string): Promise<AgentSlackConversationCount[]> {
  const data = await agentSlackJson<{ channels?: AgentSlackConversationCount[] }>(
    ['channel', 'list', '--via-counts', '--counts-only', '--limit', '10000', '--workspace', workspace],
    'channel list',
  )
  return data.channels ?? []
}

/** Channel messages newer than `oldest`, every page, oldest first. */
export async function listChannelHistory(
  workspace: string,
  channelId: string,
  oldest: string,
  options: { downloads?: boolean } = {},
): Promise<AgentSlackMessage[]> {
  const messages = new Map<string, AgentSlackMessage>()
  let latest: string | undefined
  for (;;) {
    const args = [
      'message',
      'list',
      channelId,
      '--workspace',
      workspace,
      '--oldest',
      oldest,
      '--limit',
      String(PAGE),
      ...(options.downloads ? [] : ['--no-downloads']),
      '--max-body-chars',
      '-1',
    ]
    if (latest !== undefined) args.push('--latest', latest)
    const page = (await agentSlackJson<{ messages?: AgentSlackMessage[] }>(args, 'message list')).messages ?? []
    for (const message of page) messages.set(message.ts, message)
    if (page.length < PAGE) break
    // The page is chronological; everything older than its first message is still unread
    const oldestOnPage = page.reduce((min, message) => (compareTs(message.ts, min) < 0 ? message.ts : min), page[0].ts)
    if (latest !== undefined && compareTs(oldestOnPage, latest) >= 0) break
    latest = oldestOnPage
  }
  return [...messages.values()].sort((a, b) => compareTs(a.ts, b.ts))
}

/**
 * A thread's root and every reply, oldest first. Thread mode leaves the
 * channel and thread off each message, so both are put back here.
 */
export async function listThread(
  workspace: string,
  channelId: string,
  threadTs: string,
  options: { downloads?: boolean } = {},
): Promise<AgentSlackMessage[]> {
  const data = await agentSlackJson<{ messages?: AgentSlackMessage[] }>(
    [
      'message',
      'list',
      channelId,
      '--workspace',
      workspace,
      '--thread-ts',
      threadTs,
      ...(options.downloads ? [] : ['--no-downloads']),
      '--max-body-chars',
      '-1',
    ],
    'message list --thread-ts',
  )
  return (data.messages ?? [])
    .map((message) => ({ ...message, channel_id: channelId, thread_ts: threadTs }))
    .sort((a, b) => compareTs(a.ts, b.ts))
}
