import parseLaterList from '#commands/all/slack/cli/lib/agent-slack/parseLaterList.ts'
import type { AgentSlackLaterItem, AgentSlackLaterList } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import { mpdmMemberHandles } from '#commands/all/slack/lib/mpdmMembers.ts'
import { oneLine } from './pick.ts'

/** Fetch and parse the in-progress items from Slack's Later list. */
export async function fetchInProgressLater(limit: number): Promise<{ list: AgentSlackLaterList } | { error: string }> {
  const listResult = await runAgentSlack([
    'later',
    'list',
    '--state',
    'in_progress',
    '--limit',
    String(limit),
    '--max-body-chars',
    '300',
  ])
  if (!listResult.success) {
    const detail = listResult.stderr.trim() || listResult.stdout.trim()
    const hint = detail.includes('invalid_auth') ? ' — credentials expired, run `sky slack:auth`' : ''
    return { error: `agent-slack later list failed: ${detail}${hint}` }
  }
  const list = parseLaterList(listResult.stdout)
  if (!list) {
    return { error: `Failed to parse agent-slack later list output: ${oneLine(listResult.stdout, 200)}` }
  }
  return { list }
}

/** Conversation label for a later item: person for DMs, member handles for group DMs, #name for channels. */
export function laterChannelLabel(item: AgentSlackLaterItem): string {
  // D-prefixed conversation ids are DMs (person, no #); mpdm slugs list their members
  const isDm = item.channel_id.startsWith('D')
  const name = item.channel_name?.replace(/^#/, '')
  const groupHandles = mpdmMemberHandles(name)
  if (groupHandles.length > 0) return groupHandles.join(', ')
  return name ? (isDm ? name : `#${name}`) : item.channel_id
}

/** Permalink to a later item's origin message. */
export function laterItemLink(workspace: string, item: AgentSlackLaterItem): string {
  return `${workspace}/archives/${item.channel_id}/p${item.ts.replace('.', '')}`
}
