import { identifyAgentSlackFiles } from '#commands/all/slack/cli/lib/agent-slack/files.ts'
import type { AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import type { SlackCaptureMessage } from '#commands/all/slack/lib/captureMessages.ts'
import { formatSlackTimestamp, normalizeFences, resolveContent } from '#commands/all/slack/lib/mod.ts'
import { enrichSlackFiles, type SlackCaptureFile } from '#commands/all/slack/lib/voiceFiles.ts'
import type { SlackNames } from '#commands/all/slack/pull/lib/entries.ts'

/**
 * Messages as agent-slack lists them, in the capture's shape: names in place
 * of ids, times in the notebook's zone, files identified and enriched the way
 * the export enriches them, so voice memos get their transcripts.
 */
export async function toCaptureMessages(
  messages: readonly AgentSlackMessage[],
  input: { workspace: string; timezone: string; names: SlackNames; enrich?: typeof enrichSlackFiles },
): Promise<SlackCaptureMessage[]> {
  const allFiles = identifyAgentSlackFiles(messages.flatMap((message) => message.files ?? [])) ?? []
  const enriched = allFiles.length > 0 ? await (input.enrich ?? enrichSlackFiles)(allFiles, input.workspace) : []
  const byId = new Map(enriched.flatMap((file) => (file.id ? [[file.id, file] as const] : [])))
  const { users, channels, usergroups } = input.names
  return messages.map((message) => {
    const files = identifyAgentSlackFiles(message.files)?.map((file): SlackCaptureFile => {
      const known = file.id ? byId.get(file.id) : undefined
      return {
        ...file,
        mode: known?.mode ?? file.mode,
        externalUrl: known?.externalUrl,
        sourceUrl:
          known?.sourceUrl ?? `${input.workspace}/archives/${message.channel_id}/p${message.ts.replace('.', '')}`,
        voiceMemo: known?.voiceMemo,
      }
    })
    const userId = message.author?.user_id
    const botId = message.author?.bot_id
    return {
      channelId: message.channel_id,
      ts: message.ts,
      timeLabel: formatSlackTimestamp(message.ts, input.timezone),
      text: normalizeFences(resolveContent(message.content ?? '', users, channels, usergroups)),
      ...(userId ? { userId, ...(users.get(userId) ? { userName: users.get(userId) } : {}) } : {}),
      ...(!userId && botId ? { userName: `bot ${botId}` } : {}),
      ...(files?.length ? { files } : {}),
    }
  })
}
