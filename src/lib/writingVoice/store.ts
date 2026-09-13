import { lstat, readdir, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { atomicWrite, hash, missing, readOptional, withLock } from '#lib/outbox/files.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import {
  CompactionSchema,
  ExampleId,
  ExampleInputSchema,
  ExampleSchema,
  WritingVoiceError,
  type VoiceCompaction,
  type VoiceExample,
  type VoiceExampleInput,
  type VoiceExampleRecord,
  type VoiceRules,
} from './types.ts'

export const DEFAULT_VOICE_RULES = `# Writing rules

Use natural, direct language. Preserve the supplied facts, uncertainty, intent, and commitments.

Prefer clear sentences and readable paragraphs. Adapt length, vocabulary, punctuation, and formatting to the medium and recipient.

Avoid filler, announced candor, exaggerated enthusiasm, corporate slogans, and rhetorical contrast. Say the point directly.

Treat examples as writing evidence. Their private facts, names, and situational choices belong to their original messages.
`

const now = () => new ZonedDateTime().toUTC().normalize().plainDateTime.toString()

/** A notebook-owned guide and one complete Markdown record per revision. */
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
    return { text: doc.markdown, revision, compacted: z.array(ExampleId).parse(doc.yaml.compacted ?? []) }
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

  private async writeRules(doc: Document, text: string, compacted?: string[]): Promise<void> {
    const date = this.clock().slice(0, 10)
    await atomicWrite(
      await this.file('rules.md'),
      new Document(
        {
          ...doc.yaml,
          created: doc.yaml.created ?? date,
          updated: date,
          ...(compacted ? { compacted } : {}),
        },
        text,
      ).toMarkdown(),
    )
  }

  async get(id: string): Promise<VoiceExampleRecord | null> {
    if (!ExampleId.safeParse(id).success) throw new WritingVoiceError('Invalid writing example.', 404)
    const raw = await readOptional(await this.file(`examples/${id}.md`))
    if (raw === undefined) return null
    const doc = Document.fromMarkdown(raw)
    if (doc.yamlError) throw new WritingVoiceError('A writing example has invalid frontmatter.')
    const example = ExampleSchema.parse(doc.yaml)
    if (example.id !== id) throw new WritingVoiceError('The writing example does not match its file.')
    return { ...example, revision: hash(raw) }
  }

  async list(source?: string): Promise<VoiceExampleRecord[]> {
    const compacted = new Set((await this.rules()).compacted)
    let names: string[]
    try {
      names = await readdir(await this.file('examples'))
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
    const examples: VoiceExampleRecord[] = []
    for (const name of names) {
      if (!/^[a-f0-9]{32}\.md$/.test(name) || compacted.has(name.slice(0, -3))) continue
      const example = await this.get(name.slice(0, -3))
      if (example && (!source || example.source === source)) examples.push(example)
    }
    return examples.sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id))
  }

  async capture(input: VoiceExampleInput): Promise<VoiceExampleRecord | null> {
    const value = ExampleInputSchema.parse(input)
    if (!value.original.trim() || !value.revised.trim() || value.original === value.revised) return null
    const id = hash(JSON.stringify([value.source, value.original, value.revised])).slice(0, 32)
    return this.lock(async () => {
      await this.ensureRules()
      if ((await this.rules()).compacted.includes(id)) return null
      const existing = await this.get(id)
      if (existing) return existing
      return this.write({ ...value, id, created: this.clock(), updated: this.clock() })
    })
  }

  async update(
    id: string,
    revision: string,
    patch: Partial<Pick<VoiceExample, 'question' | 'answer' | 'lesson' | 'error'>>,
  ): Promise<VoiceExampleRecord> {
    return this.lock(async () => {
      if ((await this.rules()).compacted.includes(id))
        throw new WritingVoiceError('This example has been compacted into your rules.', 409)
      const current = await this.get(id)
      if (!current) throw new WritingVoiceError('This writing example is no longer available.', 404)
      if (current.revision !== revision)
        throw new WritingVoiceError('This writing example changed. Reload it before answering.', 409)
      return this.write({ ...current, ...patch, updated: this.clock() })
    })
  }

  private async write(example: VoiceExample): Promise<VoiceExampleRecord> {
    const value = ExampleSchema.parse(example)
    const body = value.lesson
      ? `# What Sky learned\n\n${value.lesson.text}\n\nApplies to: ${value.lesson.scope}\n`
      : '# Writing example\n\nThe original draft, your revision, and the learning conversation are preserved in the frontmatter.\n'
    await atomicWrite(await this.file(`examples/${value.id}.md`), new Document(value, body).toMarkdown())
    return (await this.get(value.id))!
  }

  async compact(rules: VoiceRules, examples: VoiceExampleRecord[], plan: VoiceCompaction): Promise<number> {
    const parsed = CompactionSchema.parse(plan)
    const ids = new Set(examples.map((example) => example.id))
    const covered = new Set<string>()
    for (const lesson of [...parsed.lessons, ...parsed.covered]) {
      for (const id of lesson.examples) {
        if (!ids.has(id)) throw new WritingVoiceError('Compaction referenced an unknown example.')
        covered.add(id)
      }
    }
    if (examples.some((example) => !example.answer || !example.lesson || !covered.has(example.id)))
      throw new WritingVoiceError('Compaction must preserve the lesson from every answered example.')
    if (parsed.covered.some((entry) => !rules.text.includes(entry.quote)))
      throw new WritingVoiceError('Compaction could not find the existing rule it cited.')
    return this.lock(async () => {
      const current = await this.rulesDocument()
      if (current.revision !== rules.revision)
        throw new WritingVoiceError('Your rules changed during compaction. Try again.', 409)
      for (const example of examples) {
        if ((await this.get(example.id))?.revision !== example.revision)
          throw new WritingVoiceError('An example changed during compaction. Try again.', 409)
      }
      const additions = parsed.lessons.map((lesson) => `- **${lesson.scope}:** ${lesson.text}`).join('\n\n')
      const text = additions ? `${rules.text.trimEnd()}\n\n${additions}\n` : rules.text
      if (text.length > 80_000)
        throw new WritingVoiceError('Review and shorten your writing rules before compacting more examples.')
      // Commit lessons and their receipts together, before removing any examples.
      const receipts = [...new Set([...rules.compacted, ...ids])]
      await this.writeRules(current.doc, text, receipts)
      await this.prune(receipts)
      return examples.length
    })
  }

  private async prune(ids: string[]): Promise<void> {
    const receipts = new Set(ids)
    let files: string[]
    try {
      files = await readdir(await this.file('examples'))
    } catch (error) {
      if (missing(error)) return
      throw error
    }
    for (const file of files) {
      const id = file.endsWith('.md') ? file.slice(0, -3) : ''
      if (!receipts.has(id)) continue
      await unlink(await this.file(`examples/${ExampleId.parse(id)}.md`)).catch((error: unknown) => {
        if (!missing(error)) throw error
      })
    }
  }

  /** A crash after the rules commit leaves only deletion to finish. */
  async finishCompaction(): Promise<void> {
    await this.lock(async () => this.prune((await this.rules()).compacted))
  }
}
