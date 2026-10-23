import { collectChannelIds, collectSubteamIds, collectUserIds } from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import type { AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { resolveChannelNames, resolveUsergroupNames, resolveUserNames } from '#commands/all/slack/lib/resolveNames.ts'
import type { SlackNames } from './entries.ts'

/** The edge cache answers a batch of user ids in one call; keep batches modest. */
const USER_BATCH = 50

function* batches<T>(items: T[], size: number): Generator<T[]> {
  for (let at = 0; at < items.length; at += size) yield items.slice(at, at + size)
}

/**
 * Names for the people, channels and groups a run's messages mention, each
 * asked of Slack once and remembered for the run. Ids Slack could not name
 * are remembered too, so a bot or a departed account is not asked after again.
 */
export function createNameResolver(workspace: string): {
  names: SlackNames
  resolve: (messages: AgentSlackMessage[]) => Promise<SlackNames>
} {
  const names: SlackNames = { users: new Map(), channels: new Map(), usergroups: new Map() }
  const tried = { users: new Set<string>(), channels: new Set<string>(), usergroups: new Set<string>() }
  return {
    names,
    resolve: async (messages) => {
      const userIds = collectUserIds(messages).filter((id) => !names.users.has(id) && !tried.users.has(id))
      for (const batch of batches(userIds, USER_BATCH)) {
        for (const [id, name] of await resolveUserNames(batch, workspace)) names.users.set(id, name)
        for (const id of batch) tried.users.add(id)
      }
      const channelIds = collectChannelIds(messages).filter((id) => !names.channels.has(id) && !tried.channels.has(id))
      if (channelIds.length > 0) {
        for (const [id, name] of await resolveChannelNames(channelIds, names.users, workspace))
          names.channels.set(id, name)
        for (const id of channelIds) tried.channels.add(id)
      }
      const subteamIds = collectSubteamIds(messages).filter(
        (id) => !names.usergroups.has(id) && !tried.usergroups.has(id),
      )
      if (subteamIds.length > 0) {
        for (const [id, name] of await resolveUsergroupNames(subteamIds, workspace)) names.usergroups.set(id, name)
        for (const id of subteamIds) tried.usergroups.add(id)
      }
      return names
    },
  }
}
