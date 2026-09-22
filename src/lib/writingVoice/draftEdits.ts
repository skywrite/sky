import { hash } from '#lib/outbox/files.ts'
import type { DraftVersion, WritingDraft } from './draftTypes.ts'
import { EditId, WritingVoiceError, type VoiceEditRecord } from './types.ts'

/**
 * Sky learns from what the owner does to a draft, and from nothing else.
 * An edit is one version the owner wrote or accepted, read together with the version it replaced.
 * The question, the owner's answer and the lesson are kept on that version, in the draft's own file.
 */

/** A version Sky can still learn from, or whose lesson the rules do not hold yet. */
export const teaches = (version: DraftVersion): boolean =>
  Boolean(version.accepted && version.learnFrom && !version.learningDone && !version.folded)

export const editId = (draftId: string, version: number): string => `${draftId}:${version}`

export function parseEditId(id: string): { draftId: string; version: number } {
  if (!EditId.safeParse(id).success) throw new WritingVoiceError('Invalid writing edit.', 404)
  const at = id.lastIndexOf(':')
  return { draftId: id.slice(0, at), version: Number(id.slice(at + 1)) }
}

export function editOf(draft: WritingDraft, version: DraftVersion): VoiceEditRecord | null {
  const before = version.learnFrom ? draft.versions[version.learnFrom - 1] : undefined
  if (!before || before.text === version.text) return null
  return {
    id: editId(draft.id, version.version),
    source: `draft:${draft.id}`,
    medium: draft.input.medium,
    recipient: draft.input.recipient,
    context: draft.input.context.slice(0, 8000),
    instruction: version.direction,
    original: before.text,
    revised: version.text,
    created: version.created,
    updated: draft.updated,
    question: version.question,
    answer: version.answer,
    lesson: version.lesson,
    error: version.learningError,
    // Learning never changes the draft's words, so its own state is what an answer must be current with.
    revision: hash(
      JSON.stringify([draft.revision, version.question, version.answer, version.lesson, version.learningError]),
    ).slice(0, 16),
  }
}

/** Newest first, as the writer and the pages read them. */
export const editsOf = (draft: WritingDraft): VoiceEditRecord[] =>
  draft.versions
    .filter(teaches)
    .map((version) => editOf(draft, version))
    .filter((edit) => edit !== null)
    .toReversed()
