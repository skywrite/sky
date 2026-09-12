import { AsyncLocalStorage } from 'node:async_hooks'

/** Trusted, per-turn constraints. Conversation and retrieved documents stay with the caller. */
export interface ResearchContext {
  contextTokens: number
  instructions: string
}

export const researchContext = new AsyncLocalStorage<ResearchContext>()
