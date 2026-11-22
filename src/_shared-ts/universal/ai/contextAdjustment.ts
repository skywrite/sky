import { formatTokens } from './tokenUsage.ts'

/** What was reduced for this reply; the selected notebook allowance stays unchanged. */
export interface ContextAdjustment {
  notebookTokens?: number
  shortenedToolResults: number
  compactedSources?: number
  referencedAttachments?: number
  deferredAttachments?: number
  /**
   * Set when the chat was compacted for this reply: it had reached what the model holds, and older
   * material was cleared in one step to make room. The counts are what was cleared.
   */
  compacted?: { toolResults: number; notes: number }
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** "14 older tool results and 249 notes", for whichever of the two a compaction cleared. */
function cleared({ toolResults, notes }: NonNullable<ContextAdjustment['compacted']>): string {
  const parts = [
    ...(toolResults > 0 ? [count(toolResults, 'older tool result')] : []),
    ...(notes > 0 ? [count(notes, 'note')] : []),
  ]
  return parts.join(' and ') || 'older material'
}

/** The line a conversation shows at the reply it was compacted for, or null when it was not. */
export function compactionLine(adjustment: ContextAdjustment): string | null {
  return adjustment.compacted ? `compacted to make room · cleared ${cleared(adjustment.compacted)}` : null
}

const ASSURANCE = 'Sky can look up anything it cleared, and your messages and its replies are unchanged.'

function attachmentNotes(adjustment: ContextAdjustment): string[] {
  return [
    ...(adjustment.referencedAttachments
      ? ['Earlier attachments are available by file reference. Their originals and recorded findings are preserved.']
      : []),
    ...(adjustment.deferredAttachments
      ? ['Some attachments will need to be read separately to fit the request size limit.']
      : []),
  ]
}

/** Under a reply whose compaction line already says what was cleared: what that means, and nothing twice. */
export function contextAdjustmentNote(adjustment: ContextAdjustment): string {
  if (!adjustment.compacted) return contextAdjustmentText(adjustment)
  return [ASSURANCE, ...attachmentNotes(adjustment)].join(' ')
}

export function contextAdjustmentText(adjustment: ContextAdjustment): string {
  const notes: string[] = []
  if (adjustment.compacted) notes.push(`Compacted to make room: cleared ${cleared(adjustment.compacted)}. ${ASSURANCE}`)
  notes.push(...attachmentNotes(adjustment))
  // A compaction says what it cleared in its own sentence; these describe a reduction that was not one.
  if (adjustment.compacted) return notes.join(' ')
  if (adjustment.compactedSources)
    notes.push(
      'Older notebook excerpts were compacted to make room. Their source links and the full conversation are preserved.',
    )
  if (adjustment.notebookTokens !== undefined)
    notes.push(
      `Notebook reading reduced to about ${formatTokens(adjustment.notebookTokens)} tokens to fit this conversation.`,
    )
  if (adjustment.shortenedToolResults > 0)
    notes.push(
      'Earlier tool results were shortened for this reply. The complete results remain in the conversation history.',
    )
  return notes.join(' ')
}
