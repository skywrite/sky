import type Follow from '#shared/models/Follow/mod.ts'
import type { FollowMessage } from '#shared/models/Follow/mod.ts'
import type MessageDocument from '#shared/models/Message/mod.ts'
import { parseSlackConversation, type SlackConversation } from '#shared/models/Message/slack/parse.ts'
import { voiceTranscriptIds } from '#shared/models/Message/slack/transcripts.ts'
import { matchSlackMessages, pendingSlackAttachment } from '#shared/models/Message/slack/write.ts'
import { PlainDate, type PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { writeMessage, type SlackCaptureMessage } from './captureMessages.ts'

export interface SlackFollowSyncHost {
  read: (ref: string) => Promise<MessageDocument>
  update: (ref: string, doc: MessageDocument, messages: SlackCaptureMessage[], day: PlainDate) => Promise<void>
  create: (input: {
    messages: SlackCaptureMessage[]
    when: PlainDateTime
    previous?: string
    inherit?: MessageDocument
  }) => Promise<string>
  /** Persist new document references before processing another day, retaining the old checkpoint. */
  saveFollow: (follow: Follow) => Promise<void>
  notebookTime: (label: string) => Promise<PlainDateTime>
}

/** Sync a complete export. Saved identities, not a minute-only cursor, decide what is already captured. */
export async function syncSlackFollow(
  follow: Follow,
  fetched: readonly SlackCaptureMessage[],
  host: SlackFollowSyncHost,
): Promise<{ follow: Follow; newReplies: number; lastActivity?: PlainDateTime }> {
  const sources = [...new Map(fetched.map((message) => [writeMessage(message).id, message])).values()].sort((a, b) =>
    a.ts.localeCompare(b.ts),
  )
  const saved: { ref: FollowMessage; doc: MessageDocument; parsed: SlackConversation }[] = []
  for (const ref of follow.messages) {
    const doc = await host.read(ref.path)
    saved.push({ ref, doc, parsed: parseSlackConversation(doc.markdown) })
  }
  const matches = matchSlackMessages(
    saved.flatMap((item) => item.parsed.messages),
    sources.map(writeMessage),
  )
  const groups = new Map<
    string,
    { messages: SlackCaptureMessage[]; when: PlainDateTime; saved?: (typeof saved)[number]; needsUpdate: boolean }
  >()
  let newReplies = 0
  let lastActivity = follow.lastActivity
  const cutoff = follow.lastChecked?.normalize().toString() ?? ''
  for (const source of sources) {
    const id = writeMessage(source).id
    const match = matches.get(id)
    const existing = match ? saved.find((item) => item.parsed.messages.includes(match)) : undefined
    const when = await host.notebookTime(source.timeLabel)
    // Overlap the cursor minute. A second reply can arrive after the previous
    // fetch while sharing its displayed minute; a known ID suppresses repeats.
    if (!match && when.normalize().toString() < cutoff) continue
    const owner = existing ?? saved.find((item) => item.ref.date === when.plainDate.toString())
    const key = owner?.ref.path ?? when.plainDate.toString()
    if (!groups.has(key)) groups.set(key, { messages: [], when, saved: owner, needsUpdate: false })
    const group = groups.get(key)!
    group.messages.push(source)
    const missingFiles = (source.files ?? []).some((file) => {
      const id = file.id ? `attachment-slack-${file.id}` : undefined
      const attachment = id ? existing?.parsed.attachments.find((saved) => saved.id === id) : undefined
      return !id || !match?.attachmentIds.includes(id) || !attachment || !!pendingSlackAttachment(attachment)
    })
    const voiceIds = (source.files ?? [])
      .filter((file) => file.voiceMemo && file.id)
      .map((file) => `attachment-slack-${file.id}`)
    const transcripts = voiceTranscriptIds(match, voiceIds)
    group.needsUpdate ||= !match || missingFiles || voiceIds.some((id) => !transcripts.has(id))
    if (!lastActivity || when.normalize().toString() > lastActivity.normalize().toString()) lastActivity = when
    if (!match) {
      newReplies++
    }
  }
  for (const group of [...groups.values()].sort((a, b) =>
    a.when.normalize().toString().localeCompare(b.when.normalize().toString()),
  )) {
    if (!group.needsUpdate) continue
    if (group.saved) {
      const day = group.saved.ref.date
      // Existing captures may have been deliberately filed on another day.
      await host.update(group.saved.ref.path, group.saved.doc, group.messages, new PlainDate(day))
    } else {
      const day = group.when.plainDate.toString()
      const previous = [...follow.messages]
        .filter((ref) => ref.date < day)
        .sort((a, b) => a.date.localeCompare(b.date))
        .at(-1)
      const inheritRef = previous ?? follow.messages.at(-1)
      const ref = await host.create({
        messages: group.messages,
        when: group.when,
        previous: previous?.path,
        inherit: inheritRef ? await host.read(inheritRef.path) : undefined,
      })
      follow = follow.withMessages(
        [...follow.messages, { date: day, path: ref }].sort((a, b) => a.date.localeCompare(b.date)),
      )
      await host.saveFollow(follow)
    }
  }
  return { follow, newReplies, lastActivity }
}
