import * as path from 'node:path'
import { atomicWrite, readOptional } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import { updateSlackConversation, type SlackWriteMessage } from '#shared/models/Message/slack/write.ts'
import { type ClockLine, parseCacheLines, type ThreadLine } from './entries.ts'

/** The cache is one file per channel and UTC day, days as directories: <root>/<YYYY-MM-DD>/<channel>.md */
export function channelDayPath(root: string, day: string, fileName: string): string {
  return path.join(root, day, `${fileName}.md`)
}

/** A channel's file name is its name; the id joins it when another joined channel has the same name. */
export function channelFileName(
  channel: { id: string; name: string },
  all: readonly { id: string; name: string }[],
): string {
  const name = channel.name.replace(/[\\/\s]+/g, '-') || channel.id
  const shared = all.some((other) => other.id !== channel.id && other.name === channel.name)
  return shared ? `${name}-${channel.id}` : name
}

/** A channel-day file's header; `day` is the UTC day the file holds, and the file says so. */
export type ChannelDayHeader = { channel: string; channelId: string; workspace: string; day: string }

function newChannelDay(header: ChannelDayHeader): Document {
  return new Document(
    {
      channel: `#${header.channel}`,
      channel_id: header.channelId,
      workspace: header.workspace,
      day: header.day,
      clock: 'UTC',
    },
    `# #${header.channel} · ${header.day} UTC\n\n## Conversation\n\n`,
  )
}

/** A message that sorts after every real one; a text that swallows its heading cannot stay as it is. */
const PROBE: SlackWriteMessage = {
  id: 'message-slack-C0PROBE-2999999999-999999',
  timestamp: '2999-12-31 23:59',
  author: 'probe',
  text: 'probe',
}

/** The text inside a fence long enough that nothing in it closes the fence. */
export function fenceText(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`{3,}/g)].map((match) => match[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}\n${text}\n${fence}`
}

/**
 * Slack text is not Markdown: an unclosed code fence or HTML block would run
 * past the message's end and swallow the headings after it. Such a text is
 * kept whole inside a code fence instead. Returns the entries to write and
 * the ids of the ones fenced.
 */
export function fenceRunawayText(messages: readonly SlackWriteMessage[]): {
  entries: SlackWriteMessage[]
  fenced: string[]
} {
  const fenced: string[] = []
  const entries = messages.map((message) => {
    try {
      updateSlackConversation('## Conversation\n\n', [message, PROBE])
      return message
    } catch {
      fenced.push(message.id)
      return { ...message, text: fenceText(message.text) }
    }
  })
  return { entries, fenced }
}

/** One message as the cache holds it. */
export type CacheMessage = {
  id: string
  /** The heading's time: the notebook's day and time */
  timestamp: string
  author: string
  /** The text under the heading, clock and thread lines included */
  text: string
  /** The message's other two clocks, from its clock line */
  clock?: ClockLine
  /** For a reply: where its thread line points */
  thread?: ThreadLine
}

/** Every message in a channel-day file's text, in file order. */
export function parseChannelDay(content: string): CacheMessage[] {
  return parseSlackConversation(Document.fromMarkdown(content).markdown).messages.flatMap((message) => {
    if (!message.id) return []
    const text = message.body.trim()
    const { clock, thread } = parseCacheLines(text)
    return [
      {
        id: message.id,
        timestamp: message.timestamp,
        author: message.author,
        text,
        ...(clock ? { clock } : {}),
        ...(thread ? { thread } : {}),
      },
    ]
  })
}

/** Every message in a channel-day file; none when there is no such file. */
export async function readChannelDay(file: string): Promise<CacheMessage[]> {
  const content = await readOptional(file)
  return content === undefined ? [] : parseChannelDay(content)
}

/** Add messages to a channel-day file, creating it on first use. Returns how many were new to the file. */
export async function appendChannelDay(
  file: string,
  header: ChannelDayHeader,
  messages: readonly SlackWriteMessage[],
): Promise<{ added: number; fenced: string[] }> {
  const existing = await readOptional(file)
  const doc = existing === undefined ? newChannelDay(header) : Document.fromMarkdown(existing)
  const before = parseSlackConversation(doc.markdown).messages.length
  const { entries, fenced } = fenceRunawayText(messages)
  const markdown = updateSlackConversation(doc.markdown, entries)
  if (markdown === doc.markdown) return { added: 0, fenced }
  await atomicWrite(file, new Document(doc.yaml, markdown).toMarkdown())
  return { added: parseSlackConversation(markdown).messages.length - before, fenced }
}
