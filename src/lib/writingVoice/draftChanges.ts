import { currentDraftVersion, type WritingDraft } from './draftTypes.ts'
import { DraftInputSchema, MAX_WRITING_CHARS, WritingVoiceError, type VoiceDraftInput } from './types.ts'

export function reviseDraft(
  draft: WritingDraft,
  text: string,
  author: 'sky' | 'you',
  now: string,
  direction = '',
  input?: VoiceDraftInput,
): void {
  if (!text.trim() || text.length > MAX_WRITING_CHARS)
    throw new WritingVoiceError('Enter a nonempty draft within 40,000 characters.')
  if (currentDraftVersion(draft).text === text) return
  draft.versions.push({
    version: draft.revision + 1,
    text,
    author,
    created: now,
    direction,
    accepted: author === 'you',
    ...(author === 'you' ? { learnFrom: draft.revision, explanation: direction } : {}),
  })
  draft.revision++
  draft.updated = now
  if (input) draft.input = DraftInputSchema.parse(input)
}

export function acceptDraft(draft: WritingDraft, now: string, explanation = ''): void {
  const version = currentDraftVersion(draft)
  if (version.accepted) return
  version.accepted = true
  if (draft.revision > 1 && !version.restoredFrom) {
    version.learnFrom = draft.revision - 1
    version.explanation = explanation || version.direction
  }
  draft.updated = now
}

export function restoreDraft(draft: WritingDraft, from: number, now: string): void {
  const previous = draft.versions.find((v) => v.version === from)
  if (!previous) throw new WritingVoiceError('Choose an existing version to restore.')
  if (currentDraftVersion(draft).text === previous.text) return
  draft.versions.push({
    version: draft.revision + 1,
    text: previous.text,
    author: 'you',
    created: now,
    direction: '',
    accepted: true,
    restoredFrom: from,
  })
  draft.revision++
  draft.updated = now
}
