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
import { isOutboxItemId } from './itemId.ts'
import { dayRange, ScanRangeSchema, type SavedScanRange, type ScanRange } from './range.ts'
import { requestNeedsReply } from './requestTypes.ts'
import { draftLink } from './storage.ts'
import { ItemSchema, OutboxError, type OutboxItem, type OutboxRecord } from './types.ts'
import { unsavedOutboxDraft } from './unsavedDraft.ts'

export const DEFAULT_PREFERENCES = `Be brief, direct, empathetic, and humble. Use natural language, without AI filler.
Do not invent facts, commitments, availability, or certainty.
Do not propose a meeting unless I explicitly ask you to. Prefer resolving things in writing.
`

export type DraftWrite = {
  author?: 'sky' | 'you'
  direction?: string
  accept?: boolean
  mutation?: DraftMutation
  /** Save the shared record without changing its words, as its discussion needs one. */
  adopt?: boolean
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
    if (!isOutboxItemId(id)) throw new OutboxError('Invalid Outbox item.', 404)
    return path.join(this.dir, 'items', `${id}.md`)
  }

  private async fileNames(): Promise<string[]> {
    await this.initialize()
    try {
      return await readdir(path.join(this.dir, 'items'))
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
  }

  async get(id: string): Promise<OutboxRecord | null> {
    await this.initialize()
    const text = await readOptional(this.file(id))
    if (text === undefined) return null
    const doc = Document.fromMarkdown(text)
    if (doc.yamlError) throw new OutboxError('An Outbox item has invalid frontmatter.')
    const item = ItemSchema.parse({ ...doc.yaml, draft: doc.markdown.trim() })
    if (item.id !== id) throw new OutboxError('The Outbox item does not match its file.')
    if (!item.draftId) return this.unsaved(item, hash(text))
    if (!this.writingDrafts) throw new OutboxError('The shared draft store is unavailable.', 503)
    const writingDraft = await this.writingDrafts.get(item.draftId)
    // The owner may delete a draft's file. The item still holds the words it was last reviewed with.
    if (!writingDraft)
      return this.unsaved(
        { ...item, draft: item.reviews.at(-1)?.final ?? item.originalDraft, draftId: undefined },
        hash(text),
      )
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

  /**
   * Words nobody has worked on stay in the item. The page shows them in the shared editor,
   * and the owner's first use saves the notebook record.
   */
  private unsaved(item: OutboxItem, revision: string): OutboxRecord {
    if (!this.writingDrafts || item.status !== 'needs_review' || !item.draft.trim()) return { ...item, revision }
    try {
      return { ...item, revision, unsavedDraft: unsavedOutboxDraft(item, this.writingDrafts) }
    } catch {
      // Reading an item never depends on the editor's view of it; the page falls back to the plain reply box.
      return { ...item, revision }
    }
  }

  async list(): Promise<OutboxRecord[]> {
    const items: OutboxRecord[] = []
    for (const name of await this.fileNames()) {
      // Both file-name shapes are items; anything else in the directory is not.
      if (!name.endsWith('.md') || !isOutboxItemId(name.slice(0, -3))) continue
      const item = await this.get(name.slice(0, -3))
      if (item) items.push(item)
    }
    return items.sort((a, b) => b.updated.localeCompare(a.updated))
  }

  /**
   * The item for a saved conversation, whatever its id shape.
   * An open item wins over an archived one; otherwise the most recently updated.
   * A legacy hash-named file is the last resort.
   */
  async byConversation(key: string): Promise<OutboxRecord | null> {
    const matches = (await this.list()).filter((item) => item.conversation.key === key)
    const found = matches.find((item) => item.status !== 'dismissed') ?? matches[0]
    return found ?? this.get(hash(key).slice(0, 32))
  }

  /** A new id must not reuse an existing file name, including on a case-insensitive file system. */
  async taken(id: string): Promise<boolean> {
    const wanted = `${id}.md`.toLowerCase()
    return (await this.fileNames()).some((name) => name.toLowerCase() === wanted)
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
    // The notebook gets a record of a draft only once the owner works on it, approves it, or reports it sent.
    const used = Boolean(
      change.mutation ||
      change.adopt ||
      change.accept ||
      change.requestAction === 'sent' ||
      (change.author === 'you' && next.draft.trim() !== (before?.draft ?? '').trim()),
    )
    // Naming happens before either writer lock, and the item revision is checked again afterward.
    const adopted =
      this.writingDrafts && !next.draftId && next.draft.trim() && used
        ? await this.writingDrafts.adopt(this.shownDraft(before, next, change))
        : undefined
    if (adopted) next.draftId = adopted.id
    let linked = false
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
        linked = true
      }
      if (next.draftId && this.writingDrafts) {
        await this.writingDrafts.transaction(
          next.draftId,
          adopted?.revision ?? current?.writingDraft?.revision,
          async (draft, save) => {
            if (change.mutation) {
              // The guard reads the item's saved link, which a first use is only now writing.
              if (!adopted) await this.writingDrafts!.beforeChange(draft, 'you')
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
    }).catch(async (error: unknown) => {
      // A record no item links to would read as a draft the owner used.
      if (adopted && !linked) await this.writingDrafts!.discard(adopted.id).catch(() => {})
      throw error
    })
    if (result.draftId) this.writingDrafts?.learn(result.draftId, change.mutation?.action === 'retry-learning')
    return result
  }

  /** The history a first use saves: the words as the owner saw them, before this write changes them. */
  private shownDraft(before: OutboxRecord | null, next: OutboxItem, change: DraftWrite): WritingDraft {
    if (before?.draft.trim()) return unsavedOutboxDraft(before, this.writingDrafts!)
    const draft = unsavedOutboxDraft(next, this.writingDrafts!)
    // With no words before this write, a reply the owner typed is theirs from its first version.
    if (change.author === 'you' && draft.revision === 1)
      Object.assign(draft.versions[0]!, { author: 'you', accepted: true, learningDone: true })
    return draft
  }

  async changeDraft(
    id: string,
    revision: string,
    mutation: DraftMutation | { action: 'adopt' },
  ): Promise<OutboxRecord> {
    const item = await this.get(id)
    if (!item || !this.writingDrafts || (!item.draftId && !item.unsavedDraft))
      throw new OutboxError('Open the draft before editing it.', 409)
    if (['placing', 'placement_unknown'].includes(item.status))
      throw new OutboxError('Check the native app before changing this draft.', 409)
    return this.put(item, revision, mutation.action === 'adopt' ? { adopt: true } : { mutation })
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
