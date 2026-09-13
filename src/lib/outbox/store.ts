import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { changeDraft, type DraftMutation } from '#lib/writingVoice/draftActions.ts'
import { acceptDraft, reviseDraft } from '#lib/writingVoice/draftChanges.ts'
import type { WritingDraftStore } from '#lib/writingVoice/drafts.ts'
import { currentDraftVersion, type WritingDraft } from '#lib/writingVoice/draftTypes.ts'
import type { WritingVoiceStore } from '#lib/writingVoice/store.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { outboxDraftInput } from './draftContext.ts'
import { atomicWrite, hash, missing, readOptional, withLock } from './files.ts'
import { dayRange, ScanRangeSchema, type SavedScanRange, type ScanRange } from './range.ts'
import { requestNeedsReply } from './requestTypes.ts'
import { draftLink } from './storage.ts'
import { ItemSchema, OutboxError, type OutboxItem, type OutboxRecord } from './types.ts'

export const DEFAULT_PREFERENCES = `Be brief, direct, empathetic, and humble. Use natural language, without AI filler.
Do not invent facts, commitments, availability, or certainty.
Do not propose a meeting unless I explicitly ask you to. Prefer resolving things in writing.
`

export type DraftWrite = {
  author?: 'sky' | 'you'
  direction?: string
  accept?: boolean
  mutation?: DraftMutation
  requestAction?: 'dismissed' | 'sent'
}

export class OutboxStore {
  constructor(
    readonly dir: string,
    readonly stateDir: string,
    readonly writingVoice?: WritingVoiceStore,
    readonly writingDrafts?: WritingDraftStore,
    readonly initialize: () => Promise<void> = async () => {},
  ) {}

  private file(id: string): string {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new OutboxError('Invalid Outbox item.', 404)
    return path.join(this.dir, 'items', `${id}.md`)
  }

  async get(id: string): Promise<OutboxRecord | null> {
    await this.initialize()
    const text = await readOptional(this.file(id))
    if (text === undefined) return null
    const doc = Document.fromMarkdown(text)
    if (doc.yamlError) throw new OutboxError('An Outbox item has invalid frontmatter.')
    const item = ItemSchema.parse({ ...doc.yaml, draft: doc.markdown.trim() })
    if (item.id !== id) throw new OutboxError('The Outbox item does not match its file.')
    if (!item.draftId) return { ...item, revision: hash(text) }
    if (!this.writingDrafts) throw new OutboxError('The shared draft store is unavailable.', 503)
    const writingDraft = await this.writingDrafts.require(item.draftId)
    this.writingDrafts.learn(item.draftId)
    const draft = currentDraftVersion(writingDraft).text
    return {
      ...item,
      draft,
      writingDraft,
      edited: item.edited || writingDraft.revision > 1,
      stale: item.stale || (item.status === 'ready' && item.reviews.at(-1)?.final !== draft),
      revision: hash(`${text}\n${writingDraft.id}:${writingDraft.revision}`),
    }
  }

  async list(): Promise<OutboxRecord[]> {
    await this.initialize()
    let files: string[]
    try {
      files = await readdir(path.join(this.dir, 'items'))
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
    const items: OutboxRecord[] = []
    for (const name of files.filter((name) => /^[a-f0-9]{32}\.md$/.test(name))) {
      const item = await this.get(name.slice(0, -3))
      if (item) items.push(item)
    }
    return items.sort((a, b) => b.updated.localeCompare(a.updated))
  }

  private async initialDraft(item: OutboxItem, importing: boolean): Promise<WritingDraft> {
    const store = this.writingDrafts!
    const first = importing ? item.originalDraft.trim() || item.draft.trim() : item.draft.trim()
    const created = await store.start(outboxDraftInput(item), first, `outbox:${item.id}`)
    if (!importing) return created
    return store.transaction(created.id, created.revision, async (draft, save) => {
      for (const review of item.reviews) {
        if (review.original.trim()) reviseDraft(draft, review.original, 'sky', review.at)
        if (review.final.trim()) {
          reviseDraft(draft, review.final, 'you', review.at)
          acceptDraft(draft, review.at)
        }
      }
      reviseDraft(draft, item.draft.trim(), item.edited ? 'you' : 'sky', item.updated)
      // Existing Outbox examples have their own receipts; migration must not teach them twice.
      for (const version of draft.versions) version.learningDone = true
      await save()
      return draft
    })
  }

  async put(item: OutboxItem, revision: string | null, change: DraftWrite = {}): Promise<OutboxRecord> {
    const before = await this.get(item.id)
    if ((before?.revision ?? null) !== revision)
      throw new OutboxError('This decision changed. Reload it before saving; your text is still here.', 409)
    const next = ItemSchema.parse(item)
    if (change.requestAction && next.requests) {
      const reviewed = new Set(next.requestIds ?? [])
      next.requests = next.requests.map((request) => {
        if (!reviewed.has(request.id) || !requestNeedsReply(request)) return request
        if (change.requestAction === 'dismissed')
          return {
            ...request,
            status: 'dismissed',
            explanation: 'You archived this request.',
            dismissal: { at: next.updated, sourceVersion: next.conversation.version, kind: 'owner' },
          }
        if (!next.delivery) throw new OutboxError('Record where and when this reply was sent.')
        return {
          ...request,
          status: 'uncertain',
          resolution: null,
          explanation: 'You reported sending a reply; its coverage of this request will be checked.',
          reports: [
            ...request.reports,
            {
              at: next.delivery.at,
              sourceVersion: next.conversation.version,
              evidence: next.delivery.evidence,
              reply: next.draft,
            },
          ],
        }
      })
    }
    if (before?.status === 'dismissed' && next.status !== 'dismissed') next.draftId = undefined
    if (!next.draft.trim()) next.draftId = undefined
    // Naming happens before either writer lock, and the item revision is checked again afterward.
    const initial =
      this.writingDrafts && !next.draftId && next.draft.trim()
        ? await this.initialDraft(next, Boolean(before && !before.draftId))
        : undefined
    if (initial) next.draftId = initial.id
    const result = await withLock(path.join(this.stateDir, 'write.lock'), async () => {
      const current = await this.get(item.id)
      if ((current?.revision ?? null) !== revision)
        throw new OutboxError('This decision changed. Reload it before saving; your text is still here.', 409)
      const write = async () => {
        const { draft, ...yaml } = ItemSchema.parse(next)
        const body = next.draftId
          ? `${draftLink(path.join(this.dir, 'items'), this.writingDrafts!.voice.store.notebookDir, next.draftId)}\n`
          : `${draft.trim()}\n`
        await atomicWrite(this.file(item.id), new Document(yaml, body).toMarkdown())
      }
      if (next.draftId && this.writingDrafts) {
        await this.writingDrafts.transaction(
          next.draftId,
          initial?.revision ?? current?.writingDraft?.revision,
          async (draft, save) => {
            if (change.mutation) {
              await this.writingDrafts!.beforeChange(draft, 'you')
              changeDraft(draft, change.mutation, this.writingDrafts!.clock())
              next.draft = currentDraftVersion(draft).text
              next.edited = true
            } else {
              reviseDraft(draft, next.draft.trim(), change.author ?? 'sky', next.updated, change.direction)
              if (change.accept) acceptDraft(draft, next.updated, change.direction)
            }
            draft.input = { ...draft.input, ...outboxDraftInput(next) }
            await save()
            await write()
          },
        )
      } else await write()
      return (await this.get(item.id))!
    })
    if (result.draftId) this.writingDrafts?.learn(result.draftId, change.mutation?.action === 'retry-learning')
    return result
  }

  async ensureDraft(id: string): Promise<OutboxRecord | null> {
    const item = await this.get(id)
    if (!item || item.draftId || !item.draft.trim() || !this.writingDrafts) return item
    try {
      return await this.put(item, item.revision)
    } catch (error) {
      if (error instanceof OutboxError && error.status === 409) return this.get(id)
      throw error
    }
  }

  async changeDraft(id: string, revision: string, mutation: DraftMutation): Promise<OutboxRecord> {
    const item = await this.get(id)
    if (!item || !item.draftId || !this.writingDrafts) throw new OutboxError('Open the draft before editing it.', 409)
    if (['placing', 'placement_unknown'].includes(item.status))
      throw new OutboxError('Check the native app before changing this draft.', 409)
    return this.put(item, revision, { mutation })
  }

  async preferences(): Promise<{ text: string; revision: string }> {
    await this.initialize()
    if (this.writingVoice) return this.writingVoice.rules()
    const text = await readOptional(path.join(this.dir, 'preferences.md'))
    const doc = text === undefined ? null : Document.fromMarkdown(text)
    if (doc?.yamlError) throw new OutboxError('Communication preferences have invalid frontmatter.')
    return { text: doc?.markdown.trim() ?? DEFAULT_PREFERENCES, revision: hash(text ?? '') }
  }

  async scanRange(today: string): Promise<SavedScanRange> {
    await this.initialize()
    const text = await readOptional(path.join(this.dir, 'search.md'))
    if (text === undefined) return { value: dayRange(today), revision: hash('') }
    const doc = Document.fromMarkdown(text)
    if (doc.yamlError) throw new OutboxError('The saved Outbox search range has invalid frontmatter.')
    return { value: ScanRangeSchema.parse(doc.yaml.range), revision: hash(text) }
  }

  async saveScanRange(value: ScanRange, revision: string, today: string): Promise<void> {
    await this.initialize()
    const range = ScanRangeSchema.parse(value)
    await withLock(path.join(this.stateDir, 'write.lock'), async () => {
      if ((await this.scanRange(today)).revision !== revision)
        throw new OutboxError('The search range changed in another window. Reload before checking.', 409)
      await atomicWrite(
        path.join(this.dir, 'search.md'),
        new Document(
          { range, updated: today },
          'Dates and times follow saved message timestamps. This range stays fixed until you change it.\n',
        ).toMarkdown(),
      )
    })
  }

  async savePreferences(text: string, revision: string): Promise<void> {
    await this.initialize()
    if (this.writingVoice) {
      await this.writingVoice.saveRules(text, revision)
      return
    }
    if (text.length > 20_000) throw new OutboxError('Keep preferences under 20,000 characters.')
    await withLock(path.join(this.stateDir, 'write.lock'), async () => {
      if ((await this.preferences()).revision !== revision)
        throw new OutboxError('Preferences changed. Reload first.', 409)
      const file = path.join(this.dir, 'preferences.md')
      const previous = Document.fromMarkdown((await readOptional(file)) ?? '')
      const today = PlainDate.today().ymd
      await atomicWrite(
        file,
        new Document({ ...previous.yaml, created: previous.yaml.created ?? today, updated: today }, text).toMarkdown(),
      )
    })
  }
}
