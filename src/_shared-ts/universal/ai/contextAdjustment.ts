import { formatTokens } from './tokenUsage.ts'

/** What was reduced for this reply; the selected notebook allowance stays unchanged. */
export interface ContextAdjustment {
  notebookTokens?: number
  shortenedToolResults: number
  compactedSources?: number
  referencedAttachments?: number
  deferredAttachments?: number
}

export function contextAdjustmentText(adjustment: ContextAdjustment): string {
  const notes: string[] = []
  if (adjustment.referencedAttachments)
    notes.push(
      'Earlier attachments are available by file reference. Their originals and recorded findings are preserved.',
    )
  if (adjustment.deferredAttachments)
    notes.push('Some attachments will need to be read separately to fit the request size limit.')
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
