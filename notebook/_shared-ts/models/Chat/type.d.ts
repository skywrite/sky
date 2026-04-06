export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

/** @deprecated Use ConversationMessage instead */
export type ConversationTurn = ConversationMessage
