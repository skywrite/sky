import { resolveGmailClient } from '#commands/all/google/email/lib/resolveGmailClient.ts'
import { listActiveDrafts } from '#commands/all/slack/draft/lib/drafts.ts'
import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import { renderEmailHtml } from '#lib/google/emailHtml.ts'
import { getDraft, getThread } from '#lib/google/gmail.ts'
import { OutboxError, type OutboxRecord } from '#lib/outbox/types.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'

/** Only called after approval. Existing app edits are never silently replaced. */
export async function checkNativeDraft(
  item: OutboxRecord,
  options: { workspace: string; secrets: SecretsProvider },
): Promise<void> {
  const target = item.conversation.target
  if (!target) throw new OutboxError('No native destination is available.')
  const previousText = item.reviews.at(-1)?.final
  if (target.medium === 'Slack') {
    const workspace = options.workspace.replace(/\/$/, '')
    if (!workspace) throw new OutboxError('Connect Slack before placing this draft.')
    if (new URL(workspace).origin !== new URL(target.link).origin)
      throw new OutboxError('This conversation belongs to a different Slack workspace.')
    const parsed = parseMessageLink(target.link)!
    const page = await listActiveDrafts(workspace)
    if ('error' in page) throw new OutboxError(page.error)
    const existing = page.drafts.filter((draft) =>
      draft.destinations.some(
        (destination) => destination.channel_id === parsed.channelId && destination.thread_ts === parsed.rootTs,
      ),
    )
    if (item.native) {
      const native = existing.find((draft) => draft.id === item.native!.id)
      if (!native)
        throw new OutboxError('The Slack draft is no longer where Sky placed it. Check Slack before continuing.')
      if (native.date_scheduled || native.file_ids.length || native.text.trim() !== previousText?.trim())
        throw new OutboxError('This draft changed in Slack. Review those changes in Slack before replacing it.')
    } else if (existing.length || page.hasMore) {
      throw new OutboxError(
        existing.length
          ? 'There is already a draft in this Slack thread. Review it in Slack first.'
          : 'Slack could not show the full draft list. Check for an existing draft in the app.',
      )
    }
    return
  }
  const client = await resolveGmailClient({ secrets: options.secrets, requested: target.account, interactive: false })
  if (item.native) {
    const saved = await getDraft(client, item.native.id)
    const expected = renderEmailHtml(previousText ?? '')
      .replace(/\r\n/g, '\n')
      .trim()
    if (
      saved.draft.threadId !== target.thread ||
      saved.message.attachments.length ||
      saved.message.bodyHtml?.replace(/\r\n/g, '\n').trim() !== expected
    ) {
      throw new OutboxError('This draft changed in Gmail. Review those changes in Gmail before replacing it.')
    }
  } else {
    const thread = await getThread(client, target.thread, { format: 'metadata' })
    if (thread.some((message) => message.labelIds.includes('DRAFT')))
      throw new OutboxError('There is already a draft in this Gmail thread. Review it in Gmail first.')
  }
}
