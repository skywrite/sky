import * as path from 'node:path'
import { atomicWrite, readOptional, withLock } from '#lib/outbox/files.ts'
import { createVoiceIntelligence, type VoiceIntelligence } from './intelligence.ts'
import { WritingVoiceStore } from './store.ts'
import {
  DraftInputSchema,
  LessonSchema,
  MAX_WRITING_CHARS,
  QuestionSchema,
  WritingVoiceError,
  type VoiceDraftInput,
  type VoiceDraft,
  type VoiceExampleInput,
  type VoiceExampleRecord,
} from './types.ts'

export const AUTO_COMPACT_EXAMPLES = 8
const maintenance = new Map<string, Promise<void>>()

export class WritingVoice {
  constructor(
    readonly store: WritingVoiceStore,
    readonly intelligence: VoiceIntelligence = createVoiceIntelligence(),
  ) {}

  async draft(input: VoiceDraftInput): Promise<VoiceDraft> {
    const value = DraftInputSchema.parse(input)
    await this.store.initialize()
    const [rules, examples] = await Promise.all([this.store.rules(), this.store.list()])
    const learned = examples.filter((example) => example.answer && example.lesson)
    const relevant = learned.toSorted((a, b) => Number(b.medium === value.medium) - Number(a.medium === value.medium))
    const draft = await this.intelligence.draft({
      ...value,
      rules: rules.text,
      lessons: learned.map((example) => example.lesson!),
      examples: relevant.slice(0, 4).map((example) => ({
        ...example,
        original: example.original.slice(0, 2000),
        revised: example.revised.slice(0, 2000),
      })),
    })
    if (!draft.trim() || draft.length > MAX_WRITING_CHARS)
      throw new WritingVoiceError('The writing agent returned an invalid draft.')
    this.scheduleCompaction()
    return { draft, rulesRevision: rules.revision }
  }

  async capture(input: VoiceExampleInput): Promise<VoiceExampleRecord | null> {
    const example = await this.store.capture(input)
    return example ? this.prepare(example.id) : null
  }

  async prepare(id: string): Promise<VoiceExampleRecord> {
    const example = await this.store.get(id)
    if (!example) throw new WritingVoiceError('This writing example is no longer available.', 404)
    if (example.lesson || (example.question && !example.answer)) return example
    try {
      if (example.answer) {
        const lesson = LessonSchema.parse(await this.intelligence.learn(example))
        const learned = await this.store.update(id, example.revision, { lesson, error: undefined })
        this.scheduleCompaction()
        return learned
      }
      const question = QuestionSchema.parse(await this.intelligence.question(example))
      if (
        (!question.before && !question.after) ||
        question.before === question.after ||
        !example.original.includes(question.before) ||
        !example.revised.includes(question.after) ||
        question.options[0].toLowerCase() === question.options[1].toLowerCase()
      )
        throw new WritingVoiceError('The learning question did not match your revision. Try again.')
      return await this.store.update(id, example.revision, { question, error: undefined })
    } catch (error) {
      if (error instanceof WritingVoiceError && error.status === 409) throw error
      return this.store.update(id, example.revision, {
        error: error instanceof Error ? error.message : 'Sky could not prepare the learning question.',
      })
    }
  }

  async answer(id: string, revision: string, answer: { option?: number; text?: string }): Promise<VoiceExampleRecord> {
    const example = await this.store.get(id)
    if (!example?.question) throw new WritingVoiceError('Prepare the learning question before answering.')
    if (example.revision !== revision)
      throw new WritingVoiceError('This writing example changed. Reload before answering.', 409)
    if ((answer.option === undefined) === (answer.text === undefined))
      throw new WritingVoiceError('Choose one answer or write your own.')
    if (answer.option !== undefined && ![0, 1].includes(answer.option))
      throw new WritingVoiceError('Choose one of the two suggested answers.')
    const text = answer.option === undefined ? answer.text!.trim() : example.question.options[answer.option]
    if (!text || text.length > 4000) throw new WritingVoiceError('Keep your answer between 1 and 4,000 characters.')
    // The user's exact answer survives even if lesson extraction fails.
    await this.store.update(id, revision, { answer: text, lesson: undefined, error: undefined })
    return this.prepare(id)
  }

  async compact(force = true): Promise<{ compacted: number }> {
    return withLock(path.join(this.store.stateDir, 'compact.lock'), async () => {
      await this.store.finishCompaction()
      const examples = (await this.store.list()).filter((example) => example.answer && example.lesson)
      if (!examples.length || (!force && examples.length < AUTO_COMPACT_EXAMPLES)) return { compacted: 0 }
      const batch = examples.slice(-12)
      const rules = await this.store.rules()
      const plan = await this.intelligence.compact(rules.text, batch)
      const compacted = await this.store.compact(rules, batch, plan)
      await atomicWrite(path.join(this.store.stateDir, 'compaction.json'), JSON.stringify({ error: null, compacted }))
      return { compacted }
    })
  }

  scheduleCompaction(): void {
    const key = this.store.dir
    if (maintenance.has(key)) return
    const task = this.compact(false)
      .then(() => {})
      .catch(async (error: unknown) => {
        await atomicWrite(
          path.join(this.store.stateDir, 'compaction.json'),
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Writing example compaction failed.',
          }),
        )
      })
      .catch(() => {})
      .finally(() => maintenance.delete(key))
    maintenance.set(key, task)
  }

  async idle(): Promise<void> {
    await maintenance.get(this.store.dir)
  }

  async status() {
    const [rules, examples, raw] = await Promise.all([
      this.store.rules(),
      this.store.list(),
      readOptional(path.join(this.store.stateDir, 'compaction.json')),
    ])
    const state = raw ? (JSON.parse(raw) as { error?: string | null }) : null
    return { rules, examples, compacting: maintenance.has(this.store.dir), compactionError: state?.error ?? null }
  }
}
