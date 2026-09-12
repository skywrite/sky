import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import {
  isAttachmentsSection,
  isConversationSection,
  parseSlackConversation,
  type SlackAttachment,
  type SlackConversation,
  type SlackMessage,
} from './parse.ts'

type PreparedMessage = { source: SlackMessage; markdown: string; key: string }

/** Merge parsed captures without dropping their attachment entries or hand-written sections. */
export function mergeSlackConversations(conversations: SlackConversation[], title: string): string {
  const sectioned = conversations.some((conversation) => conversation.format !== 'legacy')
  const messages: PreparedMessage[] = []
  const byId = new Map<string, number>()
  const byContent = new Map<string, number>()
  const legacyByContent = new Map<string, number>()
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const prepared = prepareMessage(conversation, message, sectioned)
      const key = prepared.key
      const existing = message.id ? (byId.get(message.id) ?? legacyByContent.get(key)) : byContent.get(key)
      if (existing !== undefined) {
        const prior = messages[existing]
        if (prior.key !== key) throw new Error(`Conflicting saved Slack message: ${message.id}`)
        if (message.id && !prior.source.id) {
          messages[existing] = prepared
          byId.set(message.id, existing)
          legacyByContent.delete(key)
        }
        continue
      }
      const index = messages.push(prepared) - 1
      if (message.id) byId.set(message.id, index)
      else legacyByContent.set(key, index)
      byContent.set(key, index)
    }
  }
  messages.sort((a, b) => messageTime(a.source).localeCompare(messageTime(b.source)))

  const attachments: SlackAttachment[] = []
  const attachmentKeys = new Map<string, string>()
  for (const attachment of conversations.flatMap((conversation) => conversation.attachments)) {
    const text = attachment.markdown.trim()
    const key = attachment.id ?? text
    const prior = attachmentKeys.get(key)
    if (prior !== undefined) {
      if (prior !== text) throw new Error(`Conflicting saved Slack attachment: ${attachment.id}`)
      continue
    }
    attachmentKeys.set(key, text)
    attachments.push(attachment)
  }

  const extras = [...new Set(conversations.map(preservedContent).filter(Boolean))]
  const hasAttachments = conversations.some((conversation) => conversation.sections.some(isAttachmentsSection))
  const merged =
    [
      `# ${title}`,
      ...extras,
      ...(sectioned ? ['## Conversation'] : []),
      ...messages.map((message) => message.markdown),
      ...(hasAttachments ? ['## Attachments', ...attachments.map((attachment) => attachment.markdown.trim())] : []),
    ].join('\n\n') + '\n'
  const reparsed = parseSlackConversation(merged)
  if (
    reparsed.messages.length !== messages.length ||
    reparsed.attachments.length !== attachments.length ||
    reparsed.messages.some(
      (message, index) =>
        contentKey(message) !== messages[index].key ||
        message.id !== messages[index].source.id ||
        JSON.stringify(message.attachmentIds) !== JSON.stringify(messages[index].source.attachmentIds),
    )
  )
    throw new Error('Merged Slack Markdown would change message boundaries or attachment references.')
  return merged
}

function messageTime(message: SlackMessage): string {
  return PlainDateTime.fromString(message.timestamp).normalize().toString()
}

function contentKey(message: SlackMessage, body = message.body): string {
  // Legacy captures lack provider IDs. Include the body so two replies by the
  // same person in one minute do not collapse into a single message.
  return JSON.stringify([messageTime(message), message.author, body.trim()])
}

function prepareMessage(conversation: SlackConversation, message: SlackMessage, sectioned: boolean): PreparedMessage {
  let markdown = message.markdown.trimEnd()
  let bodyStart = message.bodyStart - message.start
  if (sectioned && message.level === 2) {
    // Move the entire heading hierarchy with its message. Otherwise an old
    // H3 inside the body would become a sibling of the new H3 message.
    const headings = conversation.sections.filter(
      (section) =>
        section.headingStart >= message.headingStart && section.headingStart < message.end && section.level < 6,
    )
    for (const heading of headings.toReversed()) {
      const at = heading.headingStart - message.start
      markdown = markdown.slice(0, at) + '#' + markdown.slice(at)
    }
    bodyStart++
  }
  return { source: message, markdown, key: contentKey(message, markdown.slice(bodyStart)) }
}

function preservedContent(conversation: SlackConversation): string {
  const removed = [
    ...conversation.messages,
    ...conversation.attachments,
    ...conversation.sections
      .filter(
        (section, index) =>
          (index === 0 && section.level === 1) || isConversationSection(section) || isAttachmentsSection(section),
      )
      .map((section) => ({ start: section.start, end: section.bodyStart })),
  ].sort((a, b) => a.start - b.start)
  const parts: string[] = []
  let offset = 0
  for (const range of removed) {
    if (range.start > offset) parts.push(conversation.markdown.slice(offset, range.start))
    offset = Math.max(offset, range.end)
  }
  parts.push(conversation.markdown.slice(offset))
  return parts.join('').trim()
}
