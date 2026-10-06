export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  /** A failed assistant turn. Kept outside its prose so hosts can consistently render and retry it. */
  error?: string
  /**
   * Notebook datetime the message happened (`YYYY-MM-DD HH:MM`, extended
   * hours like 25:30 allowed). Absent on transcripts from before stamps.
   */
  when?: string
}

/** @deprecated Use ConversationMessage instead */
export type ConversationTurn = ConversationMessage
