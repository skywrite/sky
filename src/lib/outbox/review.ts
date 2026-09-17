import * as path from 'node:path'
import process from 'node:process'
import { withLock } from './files.ts'
import { canQueueFollowups, prepareFollowups, reconcileFollowups } from './followups.ts'
import { isOutboxItemId } from './itemId.ts'
import { replyDestination } from './replyDestination.ts'
import type { SavedMessages } from './sources.ts'
import type { OutboxStore } from './store.ts'
import {
  MAX_OUTBOX_DRAFT_CHARS,
  OutboxError,
  type ComposeReply,
  type OutboxRecord,
  type PrepareFollowups,
} from './types.ts'

export type PlaceDraft = (item: OutboxRecord) => Promise<{ id: string; url: string }>

export class OutboxReview {
  constructor(
    readonly store: OutboxStore,
    readonly sources: SavedMessages,
    readonly place: PlaceDraft,
    readonly now: () => string,
    readonly beforePlace: (item: OutboxRecord) => Promise<void> = async () => {},
    readonly composeReply?: ComposeReply,
    readonly planFollowups?: PrepareFollowups,
  ) {}

  private async conversation(item: OutboxRecord) {
    if (item.origin === 'followup' && !item.conversation.sources.length) return item.conversation
    return this.sources.current(item.conversation)
  }

  private async checked(id: string, revision: string): Promise<OutboxRecord> {
    const item = await this.store.get(id)
    if (!item) throw new OutboxError('This decision is no longer available.', 404)
    if (item.revision !== revision)
      throw new OutboxError('This decision changed. Reload it; your text is still here.', 409)
    if (item.status === 'placing' || item.status === 'placement_unknown') {
      throw new OutboxError(
        'Check the native app: an earlier placement has not been confirmed. It will not be retried automatically.',
        409,
      )
    }
    return item
  }

  async save(id: string, revision: string, draft: string): Promise<OutboxRecord> {
    const item = await this.checked(id, revision)
    if (item.status !== 'needs_review') throw new OutboxError('This draft has already left review.', 409)
    if (draft.length > MAX_OUTBOX_DRAFT_CHARS) throw new OutboxError('Keep a reply under 40,000 characters.')
    return this.store.put({ ...item, draft, edited: true, updated: this.now() }, revision, { author: 'you' })
  }

  async dismiss(id: string, revision: string): Promise<OutboxRecord> {
    const item = await this.store.get(id)
    if (!item) throw new OutboxError('This decision is no longer available.', 404)
    if (item.status === 'placing') throw new OutboxError('Wait for draft placement to finish.', 409)
    return this.store.put({ ...item, status: 'dismissed', updated: this.now() }, revision, {
      requestAction: 'dismissed',
    })
  }

  async reportSent(id: string, revision: string, evidence: string): Promise<OutboxRecord> {
    const existing = await this.store.get(id)
    if (existing?.delivery) return reconcileFollowups(this.store, existing)
    const item = await this.checked(id, revision)
    if (!item.draft.trim() || !evidence.trim() || evidence.length > 5000)
      throw new OutboxError('Save the message text and describe where and when you sent it.')
    const sameReply = item.followupContext?.reply === item.draft
    const sent = await this.store.put(
      {
        ...item,
        status: 'dismissed',
        delivery: { at: this.now(), evidence: evidence.trim(), kind: 'owner_report' },
        responseHistory: [
          ...(item.responseHistory ?? []),
          {
            at: this.now(),
            sourceVersion: item.conversation.version,
            kind: 'owner_report',
            evidence: evidence.trim(),
            reply: item.draft,
          },
        ],
        followups: sameReply ? item.followups : undefined,
        followupContext: this.planFollowups
          ? { reply: item.draft, sourceVersion: item.conversation.version, conversation: item.conversation }
          : undefined,
        followupStatus: this.planFollowups ? 'pending' : undefined,
        followupError: undefined,
        updated: this.now(),
      },
      revision,
      { author: 'you', accept: true, requestAction: 'sent' },
    )
    return this.planFollowups ? this.completeFollowups(sent.id) : sent
  }

  async retryFollowups(id: string, revision: string): Promise<OutboxRecord> {
    const item = await this.checked(id, revision)
    if (!this.planFollowups) throw new OutboxError('Follow-up drafting is unavailable.', 503)
    if (!canQueueFollowups(item)) throw new OutboxError('Approve the original reply before preparing follow-ups.', 409)
    if (item.followupStatus === 'preparing')
      throw new OutboxError('Sky is already preparing the follow-up drafts.', 409)
    const last = item.reviews.at(-1)
    return this.store.put(
      {
        ...item,
        followupContext: item.followupContext ?? {
          reply: last?.final ?? item.draft,
          sourceVersion: last?.sourceVersion ?? item.conversation.version,
          conversation: item.conversation,
        },
        followupStatus: 'pending',
        followupError: undefined,
      },
      revision,
    )
  }

  /** Runs independently of the native handoff. A failed model call cannot undo an approved draft. */
  async completeFollowups(id: string): Promise<OutboxRecord> {
    if (!isOutboxItemId(id)) throw new OutboxError('Invalid Outbox item.', 404)
    return withLock(
      path.join(this.store.stateDir, `followups-${id}.lock`),
      async () => {
        const item = await this.store.get(id)
        if (!item) throw new OutboxError('This decision is no longer available.', 404)
        if (!this.planFollowups || !item.followupContext || !canQueueFollowups(item)) return item
        if (item.followupStatus === 'failed') return reconcileFollowups(this.store, item)
        if (item.followups !== undefined) {
          const prepared =
            item.followupStatus === 'complete'
              ? item
              : await this.store.put({ ...item, followupStatus: 'complete' }, item.revision)
          return reconcileFollowups(this.store, prepared)
        }
        const preparing = await this.store.put({ ...item, followupStatus: 'preparing' }, item.revision)
        const context = preparing.followupContext!
        let followups: OutboxRecord['followups']
        let followupError: string | undefined
        try {
          followups = await prepareFollowups(
            this.store,
            {
              ...preparing,
              draft: context.reply,
              conversation: context.conversation ?? { ...preparing.conversation, version: context.sourceVersion },
            },
            context.reply,
            this.planFollowups,
          )
        } catch (error) {
          followupError = error instanceof Error ? error.message : 'Sky could not prepare the follow-up drafts.'
        }
        const latest = await this.store.get(id)
        if (!latest) throw new OutboxError('This decision is no longer available.', 404)
        if (
          latest.followupContext?.reply !== context.reply ||
          latest.followupContext.sourceVersion !== context.sourceVersion
        )
          return latest
        const prepared = await this.store.put(
          { ...latest, followups, followupError, followupStatus: followupError ? 'failed' : 'complete' },
          latest.revision,
        )
        return reconcileFollowups(this.store, prepared)
      },
      false,
    )
  }

  async compose(
    id: string,
    revision: string,
    draft: string,
    instruction: string,
    reviewedChanges = false,
  ): Promise<OutboxRecord> {
    const saved = await this.prepareCompose(id, revision, draft, instruction)
    return this.composePrepared(saved.id, saved.revision, instruction, reviewedChanges)
  }

  async prepareCompose(id: string, revision: string, draft: string, instruction: string): Promise<OutboxRecord> {
    const item = await this.checked(id, revision)
    if (item.status !== 'needs_review' && !(item.status === 'ready' && item.stale))
      throw new OutboxError('This draft has already left review.', 409)
    if (draft.length > MAX_OUTBOX_DRAFT_CHARS || !instruction.trim() || instruction.length > 4000)
      throw new OutboxError('Give Sky a short direction for this reply (under 4,000 characters).')
    // Saving the owner's work must not depend on source checks or a successful model call.
    return this.store.put(
      {
        ...item,
        draft,
        replyDirections: [
          ...(item.replyDirections ?? []),
          { at: this.now(), text: instruction.trim(), sourceVersion: item.conversation.version },
        ].slice(-12),
        edited: true,
        updated: this.now(),
      },
      revision,
      { author: 'you' },
    )
  }

  async composePrepared(
    id: string,
    revision: string,
    instruction: string,
    reviewedChanges = false,
  ): Promise<OutboxRecord> {
    const saved = await this.checked(id, revision)
    if (saved.status !== 'needs_review' && !(saved.status === 'ready' && saved.stale))
      throw new OutboxError('This draft has already left review.', 409)
    if (!instruction.trim() || saved.replyDirections?.at(-1)?.text !== instruction.trim())
      throw new OutboxError('The saved revision direction changed. Reload before asking Sky to draft.', 409)
    if (!this.composeReply) throw new OutboxError('Reply writing is unavailable.', 503)
    const latest = await this.conversation(saved)
    if (latest.version !== saved.conversation.version) {
      await this.store.put({ ...saved, conversation: latest, stale: true, updated: this.now() }, saved.revision)
      throw new OutboxError('New messages arrived. Review the updated context before asking Sky to draft.', 409)
    }
    if (saved.stale && !reviewedChanges)
      throw new OutboxError('Review the changed context before asking Sky to draft.', 409)
    const proposal = await this.composeReply({
      // The current direction is supplied separately from the earlier conversation with the owner.
      item: { ...saved, replyDirections: saved.replyDirections?.slice(0, -1) },
      draft: saved.draft,
      instruction: instruction.trim(),
      preferences: (await this.store.preferences()).text,
      examples: (await this.store.list())
        .flatMap((record) => record.reviews)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 12),
    })
    if (proposal.action === 'ignore')
      throw new OutboxError('Sky could not prepare a reply. Give it a more specific direction.')
    if (proposal.action === 'draft' && !proposal.draft.trim())
      throw new OutboxError('Sky returned an empty reply. Try again.')
    const current = await this.conversation(saved)
    if (current.version !== latest.version) {
      await this.store.put({ ...saved, conversation: current, stale: true, updated: this.now() }, saved.revision)
      throw new OutboxError('New messages arrived while Sky was writing. Review them and try again.', 409)
    }
    return this.store.put(
      {
        ...saved,
        draft: proposal.action === 'draft' ? proposal.draft : saved.draft,
        originalDraft: saved.originalDraft || proposal.draft,
        questions: proposal.questions,
        recommendation: proposal.recommendation,
        replyOptions: proposal.replyOptions,
        updated: this.now(),
      },
      saved.revision,
      { author: 'sky', direction: instruction },
    )
  }

  async approve(id: string, revision: string, draft: string, reviewedChanges: boolean): Promise<OutboxRecord> {
    const item = await this.checked(id, revision)
    if (item.status === 'dismissed' || (item.status === 'ready' && !item.stale))
      throw new OutboxError('This decision has already been reviewed.', 409)
    const text = draft.trim()
    if (!text || text.length > MAX_OUTBOX_DRAFT_CHARS)
      throw new OutboxError('Provide the reply you want to approve (under 40,000 characters).')
    const latest = await this.conversation(item)
    if (latest.version !== item.conversation.version) {
      await this.store.put({ ...item, conversation: latest, stale: true, updated: this.now() }, revision)
      throw new OutboxError('New messages arrived. Reload the conversation and review them before approving.', 409)
    }
    if (item.stale && !reviewedChanges)
      throw new OutboxError('Review the changed context before approving this draft.', 409)
    if (!replyDestination(item, latest))
      throw new OutboxError(
        'This reply has no verified native draft destination. Copy it into the intended conversation.',
      )

    await this.beforePlace(item)
    // Provider preflight can take time. Check capture freshness again before the write boundary.
    if ((await this.conversation({ ...item, conversation: latest })).version !== latest.version) {
      throw new OutboxError('New messages arrived during review. Reload the conversation first.', 409)
    }
    const now = this.now()
    const placing = await this.store.put(
      {
        ...item,
        draft: text,
        edited: text !== item.originalDraft,
        status: 'placing',
        stale: false,
        updated: now,
        reviews: [
          ...item.reviews,
          { at: now, original: item.originalDraft, final: text, sourceVersion: latest.version },
        ],
        placementError: null,
        placementOwner: process.pid,
        followups: undefined,
        followupContext: this.planFollowups
          ? { reply: text, sourceVersion: latest.version, conversation: latest }
          : undefined,
        followupStatus: this.planFollowups ? 'pending' : undefined,
        followupError: undefined,
      },
      revision,
      { author: 'you', accept: true },
    )
    let ready: OutboxRecord
    try {
      const native = await this.place(placing)
      if (!native.id) throw new Error('The app did not return a confirmed draft reference.')
      ready = await this.store.put({ ...placing, status: 'ready', native, updated: this.now() }, placing.revision)
    } catch (error) {
      // A timeout can happen after an app accepted a draft. Never issue another create automatically.
      return this.store.put(
        {
          ...placing,
          status: 'placement_unknown',
          updated: this.now(),
          placementError: error instanceof Error ? error.message : 'Native draft placement could not be confirmed.',
        },
        placing.revision,
      )
    }
    return ready
  }
}
