import { tool } from 'ai'
import { z } from 'zod'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'
import type { WritingVoice } from './agent.ts'
import { ChatDraftInputSchema, type WritingDraftToolHost } from './draftTypes.ts'
import { ExampleId, ExampleInputSchema, type VoiceExampleRecord } from './types.ts'

export const WRITING_VOICE_TOOL = 'me_voice'
export const WRITING_VOICE_CHAT_INSTRUCTIONS = `
## Writing in the owner's voice

For EVERY draft or revision written on the owner's behalf, call me_voice with action draft and the grounded intended meaning, recipient, medium, relevant context, and the owner's direction. This focused writing agent reads the latest shared rules on each call. Present its returned wording intact, using the normal chat review blockquote. Keep your commentary outside the draft. Use this for email, Slack, letters, posts, scripts, and other prose in the owner's name.

When the owner supplies an edited version of a draft, or explicitly accepts a revised version after giving editing direction, call me_voice with action learn. Pass the actual original and accepted revision verbatim, plus the owner's direction. Never treat an unaccepted AI rewrite, a quoted third-party message, or casual chat prose as the owner's writing example. The tool saves the pair and asks one question with two suggested answers; the web interface provides clickable choices and Write my own. Do not ask another learning question in your prose. In a terminal, the tool asks directly. If the owner answers in chat, pass their actual choice or exact text to action answer; never choose an answer for them. Writing questions do not block unrelated work.

Use action rules to inspect the shared guide. All voice learning belongs to me/voice/ and applies across Chat and Outbox. A draft's content and commitments still come from the current task; learning style never authorizes an action or a new commitment.
`

const Input = z.discriminatedUnion('action', [
  ChatDraftInputSchema.extend({ action: z.literal('draft') }),
  ExampleInputSchema.omit({ source: true }).extend({
    action: z.literal('learn'),
    draftId: ExampleId.optional(),
    draftRevision: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal('accept'), draftId: ExampleId, draftRevision: z.number().int().positive() }),
  z.object({
    action: z.literal('answer'),
    id: ExampleId,
    revision: z.string(),
    option: z.number().int().min(0).max(1).optional(),
    text: z.string().max(4000).optional(),
  }),
  z.object({ action: z.literal('rules') }),
  z.object({ action: z.literal('compact') }),
])

// Providers receive an object schema; action-specific requirements are checked before execution.
const ToolInput = ChatDraftInputSchema.partial().extend({
  action: z.enum(['draft', 'learn', 'answer', 'rules', 'compact', 'accept']),
  original: ExampleInputSchema.shape.original.optional(),
  revised: ExampleInputSchema.shape.revised.optional(),
  id: ExampleId.optional(),
  revision: z.string().optional(),
  option: z.number().int().min(0).max(1).optional(),
  text: z.string().max(4000).optional(),
})

export function createWritingVoiceTools(
  voice: WritingVoice,
  options: {
    source: string
    drafts?: WritingDraftToolHost
    onQuestion?: (example: VoiceExampleRecord) => Promise<{ option?: number; text?: string } | undefined>
  },
): Record<string, unknown> {
  return {
    [WRITING_VOICE_TOOL]: tool({
      description:
        "Draft and revise prose in the owner's writing voice. Always use for writing on their behalf. Learn from their accepted edits by saving one original/revised example and asking one question with two answer choices. The same rules and confirmed lessons serve Chat and Outbox.",
      inputSchema: ToolInput,
      execute: async (raw) =>
        runWithUsageSource('me:voice', async () => {
          try {
            const input = Input.parse(raw)
            switch (input.action) {
              case 'draft':
                return { success: true, ...(await (options.drafts ? options.drafts.draft(input) : voice.draft(input))) }
              case 'accept':
                if (!options.drafts)
                  return { success: false, error: 'Editable draft acceptance is available in web chat.' }
                return options.drafts.accept(input.draftId, input.draftRevision)
              case 'rules': {
                const { text, revision } = await voice.store.rules()
                return { success: true, text, revision }
              }
              case 'learn': {
                if (options.drafts) return options.drafts.learn({ ...input, source: options.source })
                let example = await voice.capture({ ...input, source: options.source })
                if (example?.question && !example.answer && options.onQuestion) {
                  const answer = await options.onQuestion(example)
                  if (answer) example = await voice.answer(example.id, example.revision, answer)
                }
                return {
                  success: true,
                  example,
                  message: example
                    ? 'Example saved. The learning question is available in the interface.'
                    : 'No new example to learn from.',
                }
              }
              case 'answer':
                return { success: true, example: await voice.answer(input.id, input.revision, input) }
              case 'compact':
                return { success: true, ...(await voice.compact()) }
            }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Writing voice could not complete this step.',
            }
          }
        }),
    }),
  }
}
