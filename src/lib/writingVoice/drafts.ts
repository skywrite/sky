import { lstat, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { atomicWrite, missing, readOptional, withLock } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { instantNow } from '#universal/dates/nbdt/mod.ts'
import type { WritingVoice } from './agent.ts'
import { acceptDraft, restoreDraft, reviseDraft } from './draftChanges.ts'
import { WritingDraftId } from './draftId.ts'
import { createDraftName, draftSlug, draftStamp, type DraftName } from './draftName.ts'
import { currentDraftVersion, WritingDraftSchema, type DraftVersion, type WritingDraft } from './draftTypes.ts'
import { DraftInputSchema, WritingVoiceError, type VoiceDraftInput } from './types.ts'

/** Draft history stays in the notebook, independently of learning-example compaction. */
export class WritingDraftStore {
  private readonly learning = new Map<string, Promise<void>>()

  constructor(
    readonly voice: WritingVoice,
    readonly clock: () => string = instantNow,
    readonly name: DraftName = createDraftName(),
    readonly beforeChange: (draft: WritingDraft, author: 'sky' | 'you') => Promise<void> = async () => {},
  ) {}

  private async file(id: string): Promise<string> {
    WritingDraftId.parse(id)
    let at = this.voice.store.notebookDir
    for (const part of ['me', 'voice', 'drafts', `${id}.md`]) {
      at = path.join(at, part)
      try {
        if ((await lstat(at)).isSymbolicLink()) throw new WritingVoiceError('Draft files cannot be symbolic links.')
      } catch (error) {
        if (!missing(error)) throw error
      }
    }
    return at
  }

  private lock<T>(id: string, run: () => Promise<T>): Promise<T> {
    WritingDraftId.parse(id)
    return withLock(path.join(this.voice.store.stateDir, 'drafts', `${id}.lock`), run)
  }

  async get(id: string): Promise<WritingDraft | null> {
    const raw = await readOptional(await this.file(id))
    if (raw === undefined) return null
    const doc = Document.fromMarkdown(raw)
    const parsed = WritingDraftSchema.safeParse(doc.yaml.draft)
    if (doc.yamlError || !parsed.success || parsed.data.id !== id)
      throw new WritingVoiceError('This saved draft could not be read. Its file has been preserved.')
    const draft = parsed.data
    if (draft.revision !== draft.versions.length || draft.versions.some((v, i) => v.version !== i + 1))
      throw new WritingVoiceError('This draft has an invalid version history.')
    return draft
  }

  async require(id: string, revision?: number): Promise<WritingDraft> {
    const draft = await this.get(id)
    if (!draft) throw new WritingVoiceError('This draft is no longer available.', 404)
    if (revision !== undefined && draft.revision !== revision)
      throw new WritingVoiceError(
        'This draft changed. Your edit is preserved; review the latest version before saving.',
        409,
      )
    return draft
  }

  initial(
    input: VoiceDraftInput,
    text: string,
    source: string,
    id = `${draftStamp(this.clock())}_${draftSlug(text)}`,
  ): WritingDraft {
    const now = this.clock()
    return WritingDraftSchema.parse({
      id,
      source,
      created: now,
      updated: now,
      revision: 1,
      input: DraftInputSchema.parse(input),
      versions: [{ version: 1, text, author: 'sky', created: now, direction: '', accepted: false }],
    })
  }

  async create(draft: WritingDraft): Promise<WritingDraft> {
    return this.lock(draft.id, async () => {
      const prior = await this.get(draft.id)
      if (prior) return prior
      await this.write(draft)
      return draft
    })
  }

  /** Allocate under one process lock: two equal summaries in the same second never alias. */
  async start(input: VoiceDraftInput, text: string, source: string): Promise<WritingDraft> {
    const base = `${draftStamp(this.clock())}_${draftSlug(await this.name(input, text))}`
    return this.allocate(base, (id) => this.initial(input, text, source, id))
  }

  private async allocate(base: string, build: (id: string) => WritingDraft): Promise<WritingDraft> {
    return withLock(path.join(this.voice.store.stateDir, 'drafts', 'create.lock'), async () => {
      // Check the directory before listing it, including its parents.
      await this.file(base)
      const files = await readdir(path.join(this.voice.store.dir, 'drafts')).catch((error) => {
        if (missing(error)) return [] as string[]
        throw error
      })
      const used = new Set(files.map((file) => file.toLowerCase()))
      let id = base
      for (let suffix = 2; used.has(`${id}.md`.toLowerCase()); suffix++) id = `${base}-${suffix}`
      const draft = build(id)
      await this.write(draft)
      return draft
    })
  }

  async fork(id: string, source: string): Promise<WritingDraft> {
    const original = await this.require(id)
    const base = `${draftStamp(this.clock())}_${draftSlug(await this.name(original.input, currentDraftVersion(original).text))}`
    return this.allocate(base, (newId) => {
      const draft = structuredClone(original)
      draft.id = newId
      draft.source = source
      draft.created = this.clock()
      draft.updated = draft.created
      for (const version of draft.versions) {
        version.learningDone = true
        version.learningError = undefined
      }
      return draft
    })
  }

  /** The caller may coordinate its own metadata write while the text version stays locked. */
  async transaction<T>(
    id: string,
    revision: number | undefined,
    run: (draft: WritingDraft, save: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return this.lock(id, async () => {
      const draft = await this.require(id, revision)
      return run(draft, () => this.write(draft))
    })
  }

  async revise(
    id: string,
    revision: number,
    text: string,
    author: 'sky' | 'you',
    direction = '',
    input?: VoiceDraftInput,
    expectedInput?: VoiceDraftInput,
  ): Promise<WritingDraft> {
    return this.transaction(id, revision, async (draft, save) => {
      if (expectedInput && JSON.stringify(draft.input) !== JSON.stringify(expectedInput))
        throw new WritingVoiceError('The draft context changed while Sky was writing. Review it and try again.', 409)
      await this.beforeChange(draft, author)
      reviseDraft(draft, text, author, this.clock(), direction, input)
      await save()
      return draft
    })
  }

  async accept(id: string, revision: number, explanation = ''): Promise<WritingDraft> {
    return this.transaction(id, revision, async (draft, save) => {
      await this.beforeChange(draft, 'you')
      acceptDraft(draft, this.clock(), explanation)
      await save()
      return draft
    })
  }

  async restore(id: string, revision: number, from: number): Promise<WritingDraft> {
    return this.transaction(id, revision, async (draft, save) => {
      await this.beforeChange(draft, 'you')
      restoreDraft(draft, from, this.clock())
      await save()
      return draft
    })
  }

  /** Save/accept never waits for a model. Pending learning can resume after a restart. */
  learn(id: string, retry = false): void {
    if (this.learning.has(id)) return
    const task = this.learnPending(id, retry)
      .catch(() => {})
      .finally(() => this.learning.delete(id))
    this.learning.set(id, task)
  }

  private async learnPending(id: string, retry: boolean): Promise<void> {
    const draft = await this.require(id)
    for (const version of draft.versions) {
      if (!version.accepted || !version.learnFrom || version.learningDone || (version.learningError && !retry)) continue
      const original = draft.versions[version.learnFrom - 1]?.text
      if (!original) continue
      try {
        const example = await this.voice.capture(
          {
            source: `draft:${id}`,
            medium: draft.input.medium,
            recipient: draft.input.recipient,
            context: draft.input.context.slice(0, 8000),
            instruction: version.direction,
            original,
            revised: version.text,
          },
          version.explanation,
        )
        await this.updateLearning(id, version.version, {
          learningDone: true,
          exampleId: example?.id,
          learningError: undefined,
        })
      } catch (error) {
        await this.updateLearning(id, version.version, { learningError: (error as Error).message })
      }
    }
  }

  private async updateLearning(id: string, version: number, patch: Partial<DraftVersion>): Promise<void> {
    await this.lock(id, async () => {
      const draft = await this.require(id)
      Object.assign(draft.versions[version - 1]!, patch)
      await this.write(draft)
    })
  }

  async idle(): Promise<void> {
    await Promise.all(this.learning.values())
    await this.voice.idle()
  }

  private async write(draft: WritingDraft): Promise<void> {
    const valid = WritingDraftSchema.parse(draft)
    const history = valid.versions.map(
      (version) =>
        `## Version ${version.version} · ${version.author === 'you' ? 'You' : 'Sky'}${version.restoredFrom ? ` · restored from ${version.restoredFrom}` : ''}\n\n${version.text}${version.explanation || version.direction ? `\n\nWhy / direction: ${version.explanation || version.direction}` : ''}`,
    )
    await atomicWrite(
      await this.file(valid.id),
      new Document(
        { created: valid.created.slice(0, 10), updated: valid.updated.slice(0, 10), draft: valid },
        `# Draft${valid.input.recipient ? ` to ${valid.input.recipient}` : ''}\n\n${currentDraftVersion(valid).text}\n\n# Version history\n\n${history.join('\n\n')}\n`,
      ).toMarkdown(),
    )
  }
}
