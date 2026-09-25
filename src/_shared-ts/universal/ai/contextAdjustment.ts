import { formatTokens } from './tokenUsage.ts'

/** What was reduced for this reply; the selected notebook allowance stays unchanged. */
export interface ContextAdjustment {
  notebookTokens?: number
  shortenedToolResults: number
}

export function contextAdjustmentText(adjustment: ContextAdjustment): string {
  const notes: string[] = []
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
