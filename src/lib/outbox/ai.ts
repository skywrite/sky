import { generateObject } from 'ai'
import { z } from 'zod'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { prepareConversationHistory } from './history.ts'
import { outboxModel, OUTBOX_MODEL_TIMEOUT_MS } from './model.ts'
import type { Propose } from './scan.ts'

const JUDGMENT_PROMPT = new URL('./prompts/judgment.prompt.md', import.meta.url).pathname
const VOICE_PROMPT = new URL('./prompts/voice.prompt.md', import.meta.url).pathname

const Judgment = z.object({
  action: z.enum(['ignore', 'draft', 'decision']),
  title: z.string().max(160),
  situation: z.string().max(1600),
  explanation: z.string().max(1600).describe('Brief user-facing explanation of the proposed outcome.'),
  questions: z.array(z.string().max(500)).max(6),
  meaning: z.string().max(5000).describe('Grounded intended reply, or empty when a decision is needed first.'),
})
const Voice = z.object({ draft: z.string().max(8000) })

async function instructions(file: string): Promise<string> {
  return renderPromptFile(await readPromptFile(file), file, {}).output
}

/** Judgment owns what to say. The voice pass has no tools and cannot take an action. */
export function createProposer(ownerContext: string): Propose {
  return async ({ conversation, preferences, examples }) => {
    const context = { ownerContext, preferences, examples }
    const history = await prepareConversationHistory(conversation, context)
    const judgment = await generateObject({
      ...outboxModel(),
      schema: Judgment,
      instructions: await instructions(JUDGMENT_PROMPT),
      prompt: JSON.stringify({ ...context, ...history }),
      abortSignal: AbortSignal.timeout(OUTBOX_MODEL_TIMEOUT_MS),
    })
    const { action, title, situation, explanation: reasoning, questions, meaning } = judgment.object
    if (action === 'ignore' || !meaning.trim()) return { action, title, situation, reasoning, questions, draft: '' }
    const voiced = await generateObject({
      ...outboxModel(),
      schema: Voice,
      instructions: await instructions(VOICE_PROMPT),
      prompt: JSON.stringify({ medium: conversation.medium, preferences, meaning, examples }),
      abortSignal: AbortSignal.timeout(OUTBOX_MODEL_TIMEOUT_MS),
    })
    if (!voiced.object.draft.trim()) throw new Error('The voice agent returned an empty reply.')
    return { action, title, situation, reasoning, questions, draft: voiced.object.draft.trim() }
  }
}
