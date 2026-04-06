import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'

export interface ChatPromptResult {
  message: string | null
  saveOnExit: boolean
  logToDay: boolean
  splitViewEnabled: boolean
  contextScrollOffset: number
}

export interface ChatPromptOptions {
  placeholder?: string
  hint?: string
  saveOnExit: boolean
  logToDay: boolean
  splitViewEnabled: boolean
  contextScrollOffset: number
  conversation: ConversationMessage[]
  contextFiles: string[]
  summarizePaste?: (text: string) => Promise<string>
}

export interface ChatInputPromptProps {
  placeholder: string
  hint: string
  saveOnExit: boolean
  logToDay: boolean
  splitViewEnabled: boolean
  contextScrollOffset: number
  conversation: ConversationMessage[]
  contextFiles: string[]
  summarizePaste?: (text: string) => Promise<string>
  onDone: (value: ChatPromptResult) => void
}
