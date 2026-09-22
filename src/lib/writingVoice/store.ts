import { lstat } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { atomicWrite, hash, missing, readOptional, withLock } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import {
  CompactionSchema,
  EditId,
  WritingVoiceError,
  type VoiceCompaction,
  type VoiceEditRecord,
  type VoiceRules,
} from './types.ts'

export const DEFAULT_VOICE_RULES = `# Writing rules

Use natural, direct language. Preserve the supplied facts, uncertainty, intent, and commitments.

Prefer clear sentences and readable paragraphs. Adapt length, vocabulary, punctuation, and formatting to the medium and recipient.

Avoid filler, announced candor, exaggerated enthusiasm, corporate slogans, and rhetorical contrast. Say the point directly.

Treat examples as writing evidence. Their private facts, names, and situational choices belong to their original messages.
`

const now = () => new ZonedDateTime().toUTC().normalize().plainDateTime.toString()

/**
 * The notebook-owned writing guide. What Sky learns lives on the draft versions it was learned from;
 * this file receives those lessons when they are folded in.
 */
export class WritingVoiceStore {
  readonly dir: string
  constructor(
    readonly notebookDir: string,
    readonly stateDir: string,
    readonly clock: () => string = now,
    readonly outboxDir?: string,
  ) {
    this.dir = path.join(notebookDir, 'me', 'voice')
  }

  private async file(relative: string): Promise<string> {
    let at = this.notebookDir
    for (const segment of ['me', 'voice', ...relative.split('/')]) {
      at = path.join(at, segment)
      try {
        if ((await lstat(at)).isSymbolicLink())
          throw new WritingVoiceError('Writing voice files cannot be symbolic links.')
      } catch (error) {
        if (!missing(error)) throw error
      }
    }
    return at
  }

  async lock<T>(run: () => Promise<T>): Promise<T> {
    return withLock(path.join(this.stateDir, 'write.lock'), run).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'Outbox is already working. Try again in a moment.')
        throw new WritingVoiceError('Your writing voice is updating. Try again in a moment.', 409)
      throw error
    })
  }

  private async rulesDocument(): Promise<{ doc: Document; revision: string }> {
    const raw = await readOptional(await this.file('rules.md'))
    // Existing Outbox preferences seed the shared guide until its first save.
    const legacy =
      raw === undefined ? await readOptional(path.join(this.notebookDir, 'outbox', 'preferences.md')) : undefined
    // Read the legacy path first so a concurrent move cannot create a gap between the two reads.
    const relocated =
      raw === undefined && this.outboxDir ? await readOptional(path.join(this.outboxDir, 'preferences.md')) : undefined
    const text = raw ?? relocated ?? legacy
    const doc = text === undefined ? new Document({}, DEFAULT_VOICE_RULES) : Document.fromMarkdown(text)
    if (doc.yamlError) throw new WritingVoiceError('Writing rules have invalid frontmatter.')
    return { doc, revision: hash(text ?? DEFAULT_VOICE_RULES) }
  }

  async rules(): Promise<VoiceRules> {
    const { doc, revision } = await this.rulesDocument()
    return { text: doc.markdown, revision, folding: z.array(EditId).parse(doc.yaml.folding ?? []) }
  }

  async initialize(): Promise<void> {
    await this.lock(async () => this.ensureRules())
  }

  private async ensureRules(): Promise<void> {
    if ((await readOptional(await this.file('rules.md'))) !== undefined) return
    const { doc } = await this.rulesDocument()
    await this.writeRules(doc, doc.markdown)
  }

  async saveRules(text: string, revision: string): Promise<VoiceRules> {
    if (text.length > 80_000) throw new WritingVoiceError('Keep your writing rules under 80,000 characters.')
    return this.lock(async () => {
      const current = await this.rulesDocument()
      if (current.revision !== revision)
        throw new WritingVoiceError('Your writing rules changed. Reload before saving.', 409)
      await this.writeRules(current.doc, text)
      return this.rules()
    })
  }

  private async writeRules(doc: Document, text: string, folding?: string[]): Promise<void> {
    const date = this.clock().slice(0, 10)
    // `compacted` held receipts for the separate example files that lessons once lived in.
    const { compacted: _examples, folding: prior, ...yaml } = doc.yaml
    const receipts = folding ?? (prior as string[] | undefined) ?? []
    await atomicWrite(
      await this.file('rules.md'),
      new Document(
        {
          ...yaml,
          created: doc.yaml.created ?? date,
          updated: date,
          ...(receipts.length ? { folding: receipts } : {}),
        },
        text,
      ).toMarkdown(),
    )
  }

  /**
   * Save the lessons of `edits` into the rules. The same write records which edits it took,
   * so a crash before their drafts are marked can never fold a lesson in twice.
   */
  async fold(rules: VoiceRules, edits: VoiceEditRecord[], plan: VoiceCompaction): Promise<string[]> {
    const parsed = CompactionSchema.parse(plan)
    const ids = new Set(edits.map((edit) => edit.id))
    const covered = new Set<string>()
    for (const lesson of [...parsed.lessons, ...parsed.covered]) {
      for (const id of lesson.examples) {
        if (!ids.has(id)) throw new WritingVoiceError('Compaction referenced an unknown edit.')
        covered.add(id)
      }
    }
    if (edits.some((edit) => !edit.answer || !edit.lesson || !covered.has(edit.id)))
      throw new WritingVoiceError('Compaction must preserve the lesson from every answered edit.')
    if (parsed.covered.some((entry) => !rules.text.includes(entry.quote)))
      throw new WritingVoiceError('Compaction could not find the existing rule it cited.')
    return this.lock(async () => {
      const current = await this.rulesDocument()
      if (current.revision !== rules.revision)
        throw new WritingVoiceError('Your rules changed during compaction. Try again.', 409)
      const additions = parsed.lessons.map((lesson) => `- **${lesson.scope}:** ${lesson.text}`).join('\n\n')
      const text = additions ? `${rules.text.trimEnd()}\n\n${additions}\n` : rules.text
      if (text.length > 80_000)
        throw new WritingVoiceError('Review and shorten your writing rules before compacting more lessons.')
      const receipts = [...new Set([...rules.folding, ...ids])]
      await this.writeRules(current.doc, text, receipts)
      return receipts
    })
  }

  /** Every listed edit's draft is marked now; the rules stop carrying their receipts. */
  async folded(ids: string[]): Promise<void> {
    const done = new Set(ids)
    await this.lock(async () => {
      const current = await this.rulesDocument()
      const folding = z.array(EditId).parse(current.doc.yaml.folding ?? [])
      if (!folding.some((id) => done.has(id))) return
      await this.writeRules(
        current.doc,
        current.doc.markdown,
        folding.filter((id) => !done.has(id)),
      )
    })
  }
}
