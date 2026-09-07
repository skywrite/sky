import process from 'node:process'
import type { SavedMessages } from './sources.ts'
import type { OutboxStore } from './store.ts'
import { OutboxError, type OutboxRecord } from './types.ts'

export type PlaceDraft = (item: OutboxRecord) => Promise<{ id: string; url: string }>

export class OutboxReview {
  constructor(
    readonly store: OutboxStore,
    readonly sources: SavedMessages,
    readonly place: PlaceDraft,
    readonly now: () => string,
    readonly beforePlace: (item: OutboxRecord) => Promise<void> = async () => {},
  ) {}

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
    if (draft.length > 20_000) throw new OutboxError('Keep a reply under 20,000 characters.')
    return this.store.put({ ...item, draft, edited: true, updated: this.now() }, revision)
  }

  async dismiss(id: string, revision: string): Promise<OutboxRecord> {
    const item = await this.store.get(id)
    if (!item) throw new OutboxError('This decision is no longer available.', 404)
    if (item.status === 'placing') throw new OutboxError('Wait for draft placement to finish.', 409)
    return this.store.put({ ...item, status: 'dismissed', updated: this.now() }, revision)
  }

  async approve(id: string, revision: string, draft: string, reviewedChanges: boolean): Promise<OutboxRecord> {
    const item = await this.checked(id, revision)
    if (item.status === 'dismissed' || (item.status === 'ready' && !item.stale))
      throw new OutboxError('This decision has already been reviewed.', 409)
    const text = draft.trim()
    if (!text || text.length > 20_000)
      throw new OutboxError('Provide the reply you want to approve (under 20,000 characters).')
    const latest = await this.sources.current(item.conversation)
    if (latest.version !== item.conversation.version) {
      await this.store.put({ ...item, conversation: latest, stale: true, updated: this.now() }, revision)
      throw new OutboxError('New messages arrived. Reload the conversation and review them before approving.', 409)
    }
    if (item.stale && !reviewedChanges)
      throw new OutboxError('Review the new messages before approving this draft.', 409)
    if (!latest.target)
      throw new OutboxError(
        'This saved conversation has no verified native draft destination. Copy the reply into the app.',
      )

    await this.beforePlace(item)
    // Provider preflight can take time. Check capture freshness again before the write boundary.
    if ((await this.sources.current(latest)).version !== latest.version) {
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
      },
      revision,
    )
    try {
      const native = await this.place(placing)
      if (!native.id || !native.url) throw new Error('The app did not return a confirmed draft reference.')
      return await this.store.put({ ...placing, status: 'ready', native, updated: this.now() }, placing.revision)
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
  }
}
