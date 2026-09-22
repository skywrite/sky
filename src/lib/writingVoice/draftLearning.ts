import { reviseDraft } from './draftChanges.ts'
import { editId, editOf, editsOf, parseEditId, teaches } from './draftEdits.ts'
import type { WritingDraftStore } from './drafts.ts'
import type { DraftVersion, WritingDraft } from './draftTypes.ts'
import {
  EditInputSchema,
  LessonSchema,
  QuestionSchema,
  WritingVoiceError,
  type VoiceEditInput,
  type VoiceEditRecord,
} from './types.ts'

/**
 * How Sky learns from a draft. The owner's reason, given with an edit or as the answer to one
 * question, becomes a lesson kept on that version. Saving never waits for a model, and work a
 * restart interrupted starts again the next time the draft is read.
 */
export class DraftLearning {
  private readonly running = new Map<string, Promise<void>>()

  constructor(private readonly drafts: WritingDraftStore) {}

  start(id: string, retry = false): void {
    if (this.running.has(id)) return
    const task = this.pending(id, retry)
      .catch(() => {})
      .finally(() => this.running.delete(id))
    this.running.set(id, task)
  }

  async idle(): Promise<void> {
    await Promise.all(this.running.values())
  }

  private async pending(id: string, retry: boolean): Promise<void> {
    const draft = await this.drafts.get(id)
    for (const version of draft?.versions ?? []) await this.step(draft!, version, retry)
  }

  /** One step for one edit: the owner's answer becomes a lesson, or an unexplained edit gets its question. */
  private async step(draft: WritingDraft, version: DraftVersion, retry: boolean): Promise<void> {
    const edit = editOf(draft, version)
    const waiting = version.question && !version.answer && !version.explanation?.trim()
    if (!edit || !teaches(version)) return
    if (version.lesson || waiting || (version.learningError && !retry)) return
    const save = (patch: Partial<DraftVersion>, still?: (current: DraftVersion) => boolean) =>
      this.drafts.patchLearning(draft.id, version.version, patch, still)
    try {
      // A reason given with the edit is the owner's answer. Their exact words are saved before any model runs.
      const answer = version.answer ?? (version.explanation?.trim() || undefined)
      if (answer && !version.answer) await save({ answer, learningError: undefined })
      if (answer) {
        const lesson = LessonSchema.parse(await this.drafts.voice.intelligence.learn({ ...edit, answer }))
        // A later answer supersedes the one this lesson was drawn from.
        await save({ lesson, learningError: undefined }, (current) => current.answer === answer && !current.folded)
        this.drafts.voice.scheduleCompaction()
        return
      }
      const question = QuestionSchema.parse(await this.drafts.voice.intelligence.question(edit))
      if (
        (!question.before && !question.after) ||
        question.before === question.after ||
        !edit.original.includes(question.before) ||
        !edit.revised.includes(question.after) ||
        question.options[0].toLowerCase() === question.options[1].toLowerCase()
      )
        throw new WritingVoiceError('The learning question did not match your revision. Try again.')
      await save({ question, learningError: undefined }, (current) => !current.answer)
    } catch (error) {
      await save({
        learningError: error instanceof Error ? error.message : 'Sky could not learn from this edit.',
      })
    }
  }

  /** The edits whose lessons the rules do not hold yet, newest first. `source` names one draft: `draft:<id>`. */
  async edits(source?: string): Promise<VoiceEditRecord[]> {
    const only = source?.startsWith('draft:') ? source.slice('draft:'.length) : undefined
    if (source && !only) return []
    const edits: VoiceEditRecord[] = []
    for (const id of only ? [only] : await this.drafts.learningIds()) {
      const draft = await this.drafts.get(id).catch(() => null)
      if (!draft) {
        if (!only) await this.drafts.unmark(id)
        continue
      }
      edits.push(...editsOf(draft))
    }
    return edits.sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id))
  }

  async get(id: string): Promise<VoiceEditRecord> {
    const { draftId, version } = parseEditId(id)
    const draft = await this.drafts.get(draftId)
    const edit = draft?.versions[version - 1] && editOf(draft, draft.versions[version - 1]!)
    if (!edit) throw new WritingVoiceError('This edit is no longer available.', 404)
    return edit
  }

  /** Try again after a failure, or finish what a restart interrupted. */
  async prepare(id: string): Promise<VoiceEditRecord> {
    const { draftId, version } = parseEditId(id)
    const draft = await this.drafts.require(draftId)
    const target = draft.versions[version - 1]
    if (!target) throw new WritingVoiceError('This edit is no longer available.', 404)
    await this.step(draft, target, true)
    return this.get(id)
  }

  async answer(id: string, revision: string, answer: { option?: number; text?: string }): Promise<VoiceEditRecord> {
    const edit = await this.get(id)
    if (!edit.question) throw new WritingVoiceError('Prepare the learning question before answering.')
    if (edit.revision !== revision) throw new WritingVoiceError('This edit changed. Reload before answering.', 409)
    if ((answer.option === undefined) === (answer.text === undefined))
      throw new WritingVoiceError('Choose one answer or write your own.')
    if (answer.option !== undefined && ![0, 1].includes(answer.option))
      throw new WritingVoiceError('Choose one of the two suggested answers.')
    const text = answer.option === undefined ? answer.text!.trim() : edit.question.options[answer.option]
    if (!text || text.length > 4000) throw new WritingVoiceError('Keep your answer between 1 and 4,000 characters.')
    const { draftId, version } = parseEditId(id)
    // The owner's exact answer survives even if lesson extraction fails.
    const saved = await this.drafts.patchLearning(
      draftId,
      version,
      { answer: text, lesson: undefined, learningError: undefined },
      (current) => !current.folded,
    )
    if (!saved) throw new WritingVoiceError('This lesson is already part of your writing rules.', 409)
    return this.prepare(id)
  }

  /**
   * Words and the owner's change to them, from a place that kept no draft. They become a draft now,
   * because a draft is the only place Sky learns from.
   */
  async capture(input: VoiceEditInput, explanation?: string): Promise<{ draft: WritingDraft; edit: string } | null> {
    const value = EditInputSchema.parse(input)
    if (!value.original.trim() || !value.revised.trim() || value.original === value.revised) return null
    if (explanation && explanation.length > 4000)
      throw new WritingVoiceError('Keep your explanation under 4,000 characters.')
    await this.drafts.voice.store.initialize()
    // Saving the same change twice teaches it once, also after its lesson was folded into the rules.
    // This rare path may read every draft; the writer and the pages never do.
    for (const id of await this.drafts.ids()) {
      const prior = await this.drafts.get(id).catch(() => null)
      if (prior?.source !== value.source) continue
      const same = prior.versions.find(
        (version) =>
          version.learnFrom &&
          version.text === value.revised &&
          prior.versions[version.learnFrom - 1]?.text === value.original,
      )
      if (same) return { draft: prior, edit: editId(prior.id, same.version) }
    }
    const shown = this.drafts.initial(
      {
        meaning: value.original,
        medium: value.medium,
        recipient: value.recipient,
        context: value.context,
        instruction: value.instruction,
      },
      value.original,
      value.source,
      'unsaved',
    )
    reviseDraft(shown, value.revised, 'you', this.drafts.clock(), value.instruction)
    // A direction is what the owner asked for. Only their own explanation answers why.
    shown.versions[1]!.explanation = explanation?.trim() || undefined
    // The caller starts the learning: a page waits for the question, a chat turn does not.
    const saved = await this.drafts.adopt(shown)
    return { draft: saved, edit: editId(saved.id, 2) }
  }

  /** The rules hold these lessons now. Marking twice is harmless, so an interrupted fold-in can finish later. */
  async fold(ids: string[]): Promise<void> {
    for (const id of ids) {
      const { draftId, version } = parseEditId(id)
      await this.drafts.patchLearning(draftId, version, { folded: true })
    }
  }
}
