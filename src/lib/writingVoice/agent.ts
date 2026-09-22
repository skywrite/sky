import * as path from 'node:path'
import { atomicWrite, readOptional, withLock } from '#lib/outbox/files.ts'
import { createVoiceIntelligence, type VoiceIntelligence } from './intelligence.ts'
import { WritingVoiceStore } from './store.ts'
import {
  DraftInputSchema,
  MAX_WRITING_CHARS,
  WritingVoiceError,
  type VoiceDraftInput,
  type VoiceDraft,
  type VoiceEditRecord,
} from './types.ts'

export const AUTO_COMPACT_LESSONS = 8
const maintenance = new Map<string, Promise<void>>()

/** What the writer needs from the drafts: the owner's edits and their lessons, and a way to mark them folded in. */
export interface VoiceLessons {
  edits(source?: string): Promise<VoiceEditRecord[]>
  fold(ids: string[]): Promise<void>
}

export class WritingVoice {
  /** Set by the draft store. Drafts are the only thing Sky learns from, so a writer without them knows only the rules. */
  lessons?: VoiceLessons

  constructor(
    readonly store: WritingVoiceStore,
    readonly intelligence: VoiceIntelligence = createVoiceIntelligence(),
  ) {}

  /** Lessons the rules already hold, from a fold-in that did not finish marking its drafts, are not read twice. */
  private async learned(): Promise<VoiceEditRecord[]> {
    const folding = new Set((await this.store.rules()).folding)
    return ((await this.lessons?.edits()) ?? []).filter((edit) => edit.answer && edit.lesson && !folding.has(edit.id))
  }

  async draft(input: VoiceDraftInput): Promise<VoiceDraft> {
    const value = DraftInputSchema.parse(input)
    await this.store.initialize()
    const [rules, learned] = await Promise.all([this.store.rules(), this.learned()])
    const relevant = learned.toSorted((a, b) => Number(b.medium === value.medium) - Number(a.medium === value.medium))
    const draft = await this.intelligence.draft({
      ...value,
      rules: rules.text,
      lessons: learned.map((edit) => edit.lesson!),
      examples: relevant.slice(0, 4).map((edit) => ({
        ...edit,
        original: edit.original.slice(0, 2000),
        revised: edit.revised.slice(0, 2000),
      })),
    })
    if (!draft.trim() || draft.length > MAX_WRITING_CHARS)
      throw new WritingVoiceError('The writing agent returned an invalid draft.')
    this.scheduleCompaction()
    return { draft, rulesRevision: rules.revision }
  }

  /** Fold lessons into the rules. Their drafts keep them as history and stop being read for them. */
  async compact(force = true): Promise<{ compacted: number }> {
    const lessons = this.lessons
    if (!lessons) return { compacted: 0 }
    return withLock(path.join(this.store.stateDir, 'compact.lock'), async () => {
      await this.finishFolding(lessons)
      const edits = await this.learned()
      if (!edits.length || (!force && edits.length < AUTO_COMPACT_LESSONS)) return { compacted: 0 }
      const batch = edits.slice(-12)
      const rules = await this.store.rules()
      const plan = await this.intelligence.compact(rules.text, batch)
      // An answer the owner changed while the model worked must not be folded in as it was.
      const current = new Map((await this.learned()).map((edit) => [edit.id, edit.revision]))
      if (batch.some((edit) => current.get(edit.id) !== edit.revision))
        throw new WritingVoiceError('An edit changed during compaction. Try again.', 409)
      await this.store.fold(rules, batch, plan)
      await this.finishFolding(lessons)
      await atomicWrite(path.join(this.store.stateDir, 'compaction.json'), JSON.stringify({ error: null }))
      return { compacted: batch.length }
    })
  }

  /** The rules write records what it took. Marking the drafts, then dropping that record, can always be finished later. */
  private async finishFolding(lessons: VoiceLessons): Promise<void> {
    const { folding } = await this.store.rules()
    if (!folding.length) return
    await lessons.fold(folding)
    await this.store.folded(folding)
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
            error: error instanceof Error ? error.message : 'Sky could not fold your lessons into the writing rules.',
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
    const [rules, edits, raw] = await Promise.all([
      this.store.rules(),
      this.lessons?.edits() ?? [],
      readOptional(path.join(this.store.stateDir, 'compaction.json')),
    ])
    const state = raw ? (JSON.parse(raw) as { error?: string | null }) : null
    return { rules, edits, compacting: maintenance.has(this.store.dir), compactionError: state?.error ?? null }
  }
}
