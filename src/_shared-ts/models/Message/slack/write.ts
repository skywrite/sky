import { Lexer, walkTokens } from 'marked'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { isSlackAttachmentPath, slackFileHref, slackSourceUrl } from './files.ts'
import {
  isAttachmentsSection,
  isConversationSection,
  normalizeNewlines,
  parseSlackConversation,
  type SlackAttachment,
  type SlackMessage,
} from './parse.ts'
import { VOICE_TRANSCRIPT_LABEL, voiceTranscriptIds, voiceTranscriptMarker } from './transcripts.ts'

export interface SlackSavedFile {
  id: string
  name: string
  file: string
  pending?: false
}

export type SlackSavedAttachment =
  | SlackSavedFile
  | { id: string; name: string; file?: never; url: string; pending?: false }
  | { id: string; name: string; file?: never; url?: string; pending: true }

export function isSlackSavedFile(attachment: SlackSavedAttachment): attachment is SlackSavedFile {
  return typeof attachment.file === 'string'
}

const PENDING_START = '<!-- slack-attachment-pending -->'
const PENDING_END = '<!-- /slack-attachment-pending -->'

/** Only the managed pending block is replaced; attachment headings and user notes remain intact. */
export function pendingSlackAttachment(attachment: SlackAttachment): { start: number; end: number } | undefined {
  const { text, originalOffset } = normalizeNewlines(attachment.body)
  let cursor = 0
  let start: number | undefined
  for (const token of new Lexer().blockTokens(text)) {
    const at = text.indexOf(token.raw, cursor)
    if (at < 0) throw new Error('Cannot locate Slack attachment block.')
    cursor = at + token.raw.length
    if (token.type !== 'html') continue
    if (token.raw.trim() === PENDING_START) start = at
    if (start !== undefined && token.raw.trim() === PENDING_END)
      return {
        start: originalOffset(start),
        end: originalOffset(at + token.raw.indexOf(PENDING_END) + PENDING_END.length),
      }
  }
  return undefined
}

function attachmentContent(attachment: SlackSavedAttachment): string {
  if (isSlackSavedFile(attachment)) return `[Original file](<${slackFileHref(attachment.file)}>)`
  const url = slackSourceUrl(attachment.url)
  if (attachment.pending)
    return `${PENDING_START}\n\n*Original file unavailable; retry pending.*${url ? `\n\n[Source](<${url}>)` : ''}\n\n${PENDING_END}`
  if (!url) throw new Error('Invalid Slack attachment source URL.')
  return `[Original file](<${url}>)`
}

export interface SlackWriteMessage {
  id: string
  timestamp: string
  author: string
  text: string
  attachments?: SlackSavedAttachment[]
  transcripts?: { attachmentId: string; text: string }[]
  voiceAttachmentIds?: string[]
}

export function slackMessageId(channelId: string, ts: string): string {
  if (!/^[A-Z0-9]+$/.test(channelId) || !/^\d+\.\d+$/.test(ts)) throw new Error('Missing Slack message identity.')
  return `message-slack-${channelId}-${ts.replace('.', '-')}`
}

export function markdownLabel(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\\[\]*_`<>#]/g, '\\$&')
}

/** Demote actual headings, leaving examples inside fences, lists and quotations alone. */
export function slackMessageText(text: string): string {
  let result = text.trim()
  const headings = parseSlackConversation(result).sections
  const shift = Math.max(0, 4 - Math.min(...headings.map((heading) => heading.level)))
  for (const heading of headings.toReversed()) {
    if (!shift) continue
    const raw = result.slice(heading.headingStart, heading.bodyStart)
    const replacement = raw.startsWith('#')
      ? raw.replace(/^#+/, '#'.repeat(Math.min(6, heading.level + shift)))
      : `${'#'.repeat(Math.min(6, heading.level + shift))} ${heading.heading}\n`
    result = result.slice(0, heading.headingStart) + replacement + result.slice(heading.bodyStart)
  }
  return result
}

/** Upgrade the heading hierarchy in place, retaining notes and section order. */
export function sectionSlackConversation(markdown: string): string {
  const parsed = parseSlackConversation(markdown)
  const edits: { at: number; text: string }[] = []
  let previousEnd = -1
  for (const message of parsed.messages.filter((message) => message.level === 2)) {
    if (message.start !== previousEnd) edits.push({ at: message.start, text: '## Conversation\n\n' })
    for (const heading of parsed.sections) {
      if (heading.headingStart >= message.headingStart && heading.headingStart < message.end && heading.level < 6) {
        if (markdown[heading.headingStart] !== '#')
          throw new Error('Cannot safely move a setext heading in a Slack message.')
        edits.push({ at: heading.headingStart, text: '#' })
      }
    }
    previousEnd = message.end
  }
  // Stable ordering at a shared offset puts the section before the promoted heading.
  for (const edit of edits
    .map((edit, index) => ({ ...edit, index }))
    .sort((a, b) => b.at - a.at || b.index - a.index)) {
    markdown = markdown.slice(0, edit.at) + edit.text + markdown.slice(edit.at)
  }
  return markdown
}

/**
 * Recover only unambiguous legacy associations from the fetched conversation.
 * A minute and author alone cannot identify rapid replies or edited text.
 */
export function matchSlackMessages(
  saved: readonly SlackMessage[],
  incoming: readonly SlackWriteMessage[],
): Map<string, SlackMessage> {
  const matches = new Map<string, SlackMessage>()
  const candidates = [...new Map(incoming.map((message) => [message.id, message])).values()]
  for (const message of candidates) {
    const explicit = saved.filter((prior) => prior.id === message.id)
    if (explicit.length > 1) throw new Error(`Duplicate Slack message ID: ${message.id}`)
    if (explicit[0]) matches.set(message.id, explicit[0])
  }
  for (const message of candidates.filter((message) => !matches.has(message.id))) {
    const key = legacyKey(message.timestamp, markdownLabel(message.author))
    const peers = candidates.filter(
      (candidate) => legacyKey(candidate.timestamp, markdownLabel(candidate.author)) === key,
    )
    const available = saved.filter(
      (prior) =>
        !prior.id && ![...matches.values()].includes(prior) && legacyKey(prior.timestamp, prior.author) === key,
    )
    const text = comparableText(message.text)
    const matching = available.filter((prior) => {
      const body = comparableText(prior.body)
      return body === text || (!text && body === '(empty)') || (!!text && body.startsWith(text + '\n\n'))
    })
    const sameText = peers.filter((peer) => comparableText(peer.text) === text)
    if (matching.length === 1 && sameText.length === 1) matches.set(message.id, matching[0])
  }
  return matches
}

function comparableText(text: string): string {
  let result = text.replace(/\r\n?/g, '\n').trim()
  for (const heading of parseSlackConversation(result).sections.toReversed()) {
    result = result.slice(0, heading.headingStart) + `###### ${heading.heading}\n` + result.slice(heading.bodyStart)
  }
  return result.trim()
}

function legacyKey(timestamp: string, author: string): string {
  return `${PlainDateTime.fromString(timestamp).normalize()}\n${author}`
}

/** The stored filename in an attachment entry; fragments and remote links are not local files. */
export function slackAttachmentFile(attachment: SlackAttachment): string | undefined {
  if (pendingSlackAttachment(attachment)) return undefined
  let file: string | undefined
  let originalFound = false
  walkTokens(Lexer.lex(attachment.body), (token) => {
    if (file || originalFound || token.type !== 'link') return
    // A remote original is complete even when a user note links to a local file.
    if (token.text === 'Original file') originalFound = true
    let href: string
    try {
      href = decodeURIComponent(token.href)
    } catch {
      return
    }
    if (!token.href.startsWith('#') && isSlackAttachmentPath(href)) file = href
  })
  return file
}

/** Add source identities, file references and new replies without replacing saved message bodies. */
export function updateSlackConversation(
  markdown: string,
  messages: readonly SlackWriteMessage[],
  files: readonly SlackSavedAttachment[] = [],
): string {
  const original = parseSlackConversation(markdown)
  const originalMatches = matchSlackMessages(original.messages, messages)
  markdown = sectionSlackConversation(markdown)
  const sectioned = parseSlackConversation(markdown)
  if (!sectioned.sections.some(isConversationSection))
    markdown = insertBlock(
      markdown,
      sectioned.sections.find(isAttachmentsSection)?.start ?? markdown.length,
      '## Conversation',
    )
  const initial = parseSlackConversation(markdown)
  if (
    initial.messages.length !== original.messages.length ||
    initial.attachments.length !== original.attachments.length
  )
    throw new Error('Slack format conversion would change message or attachment boundaries.')
  const unique = [...new Map(messages.map((message) => [message.id, message])).values()]
  const matches = new Map(
    [...originalMatches].map(([id, message]) => [id, initial.messages[original.messages.indexOf(message)]]),
  )
  let added = 0
  for (const message of unique.toSorted((a, b) => messageOrder(a).localeCompare(messageOrder(b)))) {
    validateId(message.id)
    const parsed = parseSlackConversation(markdown)
    const legacy = matches.get(message.id)
    const prior =
      parsed.messages.find((item) => item.id === message.id) ??
      (legacy ? parsed.messages.find((item) => !item.id && item.markdown === legacy.markdown) : undefined)
    const refs = (message.attachments ?? [])
      .filter((file) => !prior?.attachmentIds.includes(file.id))
      .map((file) => `[${markdownLabel(file.name)}](#${file.id})`)
      .join('\n\n')
    const existingTranscripts = voiceTranscriptIds(
      prior,
      message.voiceAttachmentIds ?? (message.transcripts ?? []).map((t) => t.attachmentId),
    )
    const transcripts = [...new Map((message.transcripts ?? []).map((t) => [t.attachmentId, t])).values()]
      .filter((t) => t.text.trim() && !existingTranscripts.has(t.attachmentId))
      .map(
        (t) =>
          `${voiceTranscriptMarker(t.attachmentId)}\n\n${VOICE_TRANSCRIPT_LABEL}\n\n${t.text.trim().replace(/\r\n?/g, '\n').split('\n').map(markdownLabel).join('\n')}`,
      )
      .join('\n\n')
    if (prior) {
      let block = prior.markdown
      if (!prior.id) block = `<a id="${message.id}"></a>\n\n` + block
      if (refs || transcripts) {
        if (prior.body.trim() === '(empty)' && !message.text.trim()) block = block.replace(/\(empty\)\s*$/, '')
        block = appendBlock(block, [refs, transcripts].filter(Boolean).join('\n\n'))
      }
      markdown = markdown.slice(0, prior.start) + block + markdown.slice(prior.end)
    } else {
      const collision = parsed.messages.some(
        (item) =>
          !item.id &&
          legacyKey(item.timestamp, item.author) === legacyKey(message.timestamp, markdownLabel(message.author)),
      )
      if (collision)
        throw new Error('Cannot unambiguously match a legacy Slack message; saved content was left intact.')
      const body = slackMessageText(message.text) || (!refs && !transcripts ? '(empty)' : '')
      const block = `<a id="${message.id}"></a>\n\n### ${message.timestamp} - **${markdownLabel(message.author)}**\n\n${[body, refs, transcripts].filter(Boolean).join('\n\n')}`
      const later = parsed.messages.find((item) => messageOrder(item) > messageOrder(message))
      const at = later?.start ?? parsed.sections.filter(isConversationSection).at(-1)!.end
      markdown = insertBlock(markdown, at, block)
      added++
    }
  }
  const inventory = [
    ...new Map(
      [...files, ...unique.flatMap((message) => message.attachments ?? [])].map((file) => [file.id, file]),
    ).values(),
  ]
  for (const file of inventory) {
    validateId(file.id)
    let parsed = parseSlackConversation(markdown)
    const existing = parsed.attachments.find((attachment) => attachment.id === file.id)
    if (existing) {
      const pending = pendingSlackAttachment(existing)
      if (pending && !file.pending) {
        markdown =
          markdown.slice(0, existing.bodyStart + pending.start) +
          attachmentContent(file) +
          markdown.slice(existing.bodyStart + pending.end)
      }
      continue
    }
    if (!parsed.sections.some(isAttachmentsSection)) {
      markdown = appendBlock(markdown, '## Attachments')
      parsed = parseSlackConversation(markdown)
    }
    markdown = insertBlock(
      markdown,
      parsed.sections.filter(isAttachmentsSection).at(-1)!.end,
      `<a id="${file.id}"></a>\n\n### ${markdownLabel(file.name)}\n\n${attachmentContent(file)}`,
    )
  }
  const final = parseSlackConversation(markdown)
  if (
    final.messages.length !== initial.messages.length + added ||
    unique.some((message) => final.messages.filter((item) => item.id === message.id).length !== 1) ||
    inventory.some((file) => final.attachments.filter((item) => item.id === file.id).length !== 1) ||
    unique.some((message) =>
      (message.attachments ?? []).some(
        (file) => !final.messages.find((item) => item.id === message.id)?.attachmentIds.includes(file.id),
      ),
    ) ||
    unique.some((message) =>
      (message.transcripts ?? []).some(
        (t) => !final.messages.find((item) => item.id === message.id)?.attachmentIds.includes(t.attachmentId),
      ),
    )
  ) {
    throw new Error('Slack Markdown update would change message boundaries or attachment references.')
  }
  return markdown
}

function messageOrder(message: { timestamp: string; id?: string }): string {
  // IDs include seconds and microseconds for messages that share a displayed minute.
  return `${PlainDateTime.fromString(message.timestamp).normalize()} ${message.id?.split('-').slice(-2).join('.') ?? ''}`
}

function validateId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid Slack document anchor.')
}

function insertBlock(markdown: string, at: number, block: string): string {
  return appendBlock(markdown.slice(0, at), block) + (at < markdown.length ? '\n' + markdown.slice(at) : '')
}

function appendBlock(markdown: string, block: string): string {
  return (
    markdown +
    (markdown.endsWith('\n\n') ? '' : markdown.endsWith('\n') ? '\n' : markdown ? '\n\n' : '') +
    block +
    '\n\n'
  )
}
