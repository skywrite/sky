import type { CommandTypesRegistry } from '#commands/lib/core/CommandTypesRegistry.ts'
import { VOICE_TRANSCRIPT_LABEL } from '#shared/models/Message/slack/transcripts.ts'
import { slackMessageId, type SlackWriteMessage } from '#shared/models/Message/slack/write.ts'
import currentTimezoneIANA from '#universal/dates/timezones/currentTimezoneIANA.ts'
import formatSlackTimestamp from './formatSlackTimestamp.ts'
import type { SlackCaptureFile } from './voiceFiles.ts'

export interface SlackCaptureMessage {
  channelId: string
  ts: string
  timeLabel: string
  text: string
  userName?: string
  userId?: string
  files?: SlackCaptureFile[]
}

export function captureMessages(
  data: NonNullable<CommandTypesRegistry['slack:cli:export']['result']>,
): SlackCaptureMessage[] {
  return [data.message, ...(data.thread?.replies ?? [])]
    .map((message) => ({
      ...message,
      channelId: data.channelId,
      timeLabel: message.timeLabel || formatSlackTimestamp(message.ts, currentTimezoneIANA()),
    }))
    .sort((a, b) => a.ts.localeCompare(b.ts))
}

export function writeMessage(message: SlackCaptureMessage): SlackWriteMessage {
  return {
    id: slackMessageId(message.channelId, message.ts),
    timestamp: message.timeLabel,
    author: message.userName || message.userId || '-',
    text: message.text,
  }
}

/** Typed text and completed voice transcripts; ordinary attachments remain opaque. */
export function captureMessageText(message: { text: string; files?: SlackCaptureFile[] }): string {
  const transcripts = (message.files ?? []).flatMap((file) => {
    if (!file.voiceMemo) return []
    const text = file.voiceTranscript?.trim()
    return text ? [`${VOICE_TRANSCRIPT_LABEL}\n\n${text}`] : []
  })
  return [message.text, ...transcripts].filter(Boolean).join('\n\n')
}

/** Context for title/tag classification, including prepared voice transcripts. */
export function captureText(messages: readonly SlackCaptureMessage[]): string {
  return messages
    .map(
      (message) =>
        `${message.timeLabel} - ${message.userName || message.userId || '-'}\n\n${captureMessageText(message)}`,
    )
    .join('\n\n')
}
