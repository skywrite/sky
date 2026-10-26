import * as path from 'node:path'
import type { DayChatActivity } from '#shared/models/Chat/ChatStore/dayActivity.ts'

const label = (text: string) =>
  text.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]').replace(/\s+/g, ' ')

export function chatActivitySource(chat: DayChatActivity, summaryDir: string, serviceUrl: string): string {
  // The existing source resolver follows this identity through filing and restart.
  // A live chat has no final filename yet; a guessed path would break on Save & close.
  return chat.id
    ? `${serviceUrl.replace(/\/$/, '')}/chat/source/${encodeURIComponent(chat.id)}`
    : path.relative(summaryDir, chat.path!)
}

export function chatActivityInput(chats: DayChatActivity[], summaryDir: string, serviceUrl: string): string {
  if (!chats.length) return ''
  return [
    '# AI conversations active on the summarized day',
    'Only messages from this notebook day appear below. Their transcript may live under an earlier day.',
    'Use the supplied source link verbatim. User and Sky messages remain separate evidence; Sky suggestions are not completed actions.',
    ...chats.map((chat) =>
      [
        `## ${chat.title}`,
        `Started: ${chat.started}. Activity: ${chat.day}. Transcript home: ${chat.filedDay}. ${chat.open ? 'Open' : 'Saved'} when summarized.`,
        `Source: <${chatActivitySource(chat, summaryDir, serviceUrl)}>`,
        ...chat.messages.map(
          (message) =>
            `### ${message.when ?? 'Time not recorded'} — ${message.role === 'user' ? 'User' : 'Sky'}\n\n${message.content}`,
        ),
      ].join('\n\n'),
    ),
  ].join('\n\n')
}

/** Visible provenance is deterministic and survives reading the summary outside Sky. */
export function chatActivitySources(chats: DayChatActivity[], summaryDir: string, serviceUrl: string): string {
  if (!chats.length) return ''
  return (
    '\n\n## Conversations active this day\n\n' +
    chats
      .map(
        (chat) =>
          `- [${label(chat.title)}](<${chatActivitySource(chat, summaryDir, serviceUrl)}>) — ${chat.started < chat.day ? 'Continued conversation. ' : ''}` +
          `Started ${chat.started}; activity on ${chat.day}. Transcript home: ${chat.filedDay}. ` +
          `${chat.open ? 'Still open' : 'Saved'} when summarized.`,
      )
      .join('\n') +
    '\n'
  )
}
