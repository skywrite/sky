import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import * as path from 'node:path'
import { atomicWrite, missing, readOptional, withLock } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { WritingVoice } from './agent.ts'
import { currentDraftVersion, WritingDraftSchema, type DraftVersion, type WritingDraft } from './draftTypes.ts'
import { DraftInputSchema, ExampleId, MAX_WRITING_CHARS, WritingVoiceError, type VoiceDraftInput } from './types.ts'

/** Draft history stays in the notebook, independently of learning-example compaction. */
export class WritingDraftStore {
  private readonly learning = new Map<string, Promise<void>>()

  constructor(
    readonly voice: WritingVoice,
    readonly clock: () => string = () => ZonedDateTime.now().toUTC().normalize().toString(),
  ) {}

  private async file(id: string): Promise<string> {
    ExampleId.parse(id)
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
    ExampleId.parse(id)
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

  initial(input: VoiceDraftInput, text: string, source: string, id = randomUUID().replaceAll('-', '')): WritingDraft {
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

  async fork(id: string, source: string): Promise<WritingDraft> {
    const original = await this.require(id)
    const draft = structuredClone(original)
    draft.id = randomUUID().replaceAll('-', '')
    draft.source = source
    draft.created = this.clock()
    draft.updated = draft.created
    for (const version of draft.versions) {
      version.learningDone = true
      version.learningError = undefined
    }
    return this.create(draft)
  }

  async revise(
    id: string,
    revision: number,
    text: string,
    author: 'sky' | 'you',
    direction = '',
    input?: VoiceDraftInput,
  ): Promise<WritingDraft> {
    if (!text.trim() || text.length > MAX_WRITING_CHARS)
      throw new WritingVoiceError('Enter a nonempty draft within 40,000 characters.')
    return this.lock(id, async () => {
      const draft = await this.require(id, revision)
      if (currentDraftVersion(draft).text === text) return draft
      const now = this.clock()
      const version: DraftVersion = {
        version: revision + 1,
        text,
        author,
        created: now,
        direction,
        accepted: author === 'you',
        ...(author === 'you' ? { learnFrom: revision, explanation: direction } : {}),
      }
      draft.versions.push(version)
      draft.revision++
      draft.updated = now
      if (input) draft.input = DraftInputSchema.parse(input)
      await this.write(draft)
      return draft
    })
  }

  async accept(id: string, revision: number, explanation = ''): Promise<WritingDraft> {
    return this.lock(id, async () => {
      const draft = await this.require(id, revision)
      const version = currentDraftVersion(draft)
      if (version.accepted) return draft
      version.accepted = true
      if (revision > 1 && !version.restoredFrom) {
        version.learnFrom = revision - 1
        version.explanation = explanation || version.direction
      }
      draft.updated = this.clock()
      await this.write(draft)
      return draft
    })
  }

  async restore(id: string, revision: number, from: number): Promise<WritingDraft> {
    return this.lock(id, async () => {
      const draft = await this.require(id, revision)
      const previous = draft.versions.find((v) => v.version === from)
      if (!previous) throw new WritingVoiceError('Choose an existing version to restore.')
      if (currentDraftVersion(draft).text === previous.text) return draft
      const now = this.clock()
      draft.versions.push({
        version: revision + 1,
        text: previous.text,
        author: 'you',
        created: now,
        direction: '',
        accepted: true,
        restoredFrom: from,
      })
      draft.revision++
      draft.updated = now
      await this.write(draft)
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
