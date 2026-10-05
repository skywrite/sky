import { tool } from 'ai'
import { z } from 'zod'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'
import { apiErrorMessage } from '#shared/models/Chat/ChatEngine/turnErrorMessage.ts'
import { toolDisplayName } from '#universal/ai/toolDisplay.ts'
import { WritingDraftId } from './draftId.ts'
import type { WritingDraftStore } from './drafts.ts'
import { ChatDraftInputSchema, type WritingDraftToolHost } from './draftTypes.ts'
import { EditId, EditInputSchema, type VoiceEditRecord } from './types.ts'

export const WRITING_VOICE_TOOL = 'me_voice'
const AGENT_NAME = toolDisplayName(WRITING_VOICE_TOOL)
export const WRITING_VOICE_CHAT_INSTRUCTIONS = `
## ${AGENT_NAME}: writing in the owner's voice

${AGENT_NAME} is the owner's personal drafting agent. Refer to this agent as ${AGENT_NAME} when speaking to the owner. Its callable tool ID is me_voice.

Use me_voice only for the owner's personal communications written in their own voice: emails, messages, letters, posts authored as the owner, and scripts they will personally deliver. For these drafts and revisions, call action draft with the grounded intended meaning, recipient, medium, relevant context, and the owner's direction. ${AGENT_NAME} reads the latest shared rules on each call. Present its returned wording intact, using the normal chat review blockquote. Keep your commentary outside the draft.

Write UI copy, product copy, interface mockups, specifications, documentation, sample dialogue, and other general writing directly in chat. These are outside ${AGENT_NAME}'s scope. A request to write, draft, or revise text does not by itself make it a personal communication. Do not create, revise, accept, or learn from this material through me_voice, even if an earlier turn mistakenly presented it in a ${AGENT_NAME} draft frame. It must not become a personal writing example or preference.

When the owner supplies an edited version of a personal communication in their own voice, or explicitly accepts a revised version after giving editing direction, call me_voice with action learn. Pass the actual original and accepted revision verbatim, plus the owner's direction. Never treat an unaccepted AI rewrite, a quoted third-party message, UI or product copy, other general writing, or casual chat prose as the owner's writing example. The tool saves the pair and asks one question with two suggested answers; the web interface provides clickable choices and Write my own. Do not ask another learning question in your prose. In a terminal, the tool asks directly. If the owner answers in chat, pass their actual choice or exact text to action answer; never choose an answer for them. Writing questions do not block unrelated work.

Use action rules to inspect the shared guide. Everything learned is kept with the draft it came from, under me/voice/, and applies across Chat and Outbox. A draft's content and commitments still come from the current task; learning style never authorizes an action or a new commitment.
`

const Input = z.discriminatedUnion('action', [
  ChatDraftInputSchema.extend({ action: z.literal('draft') }),
  EditInputSchema.omit({ source: true }).extend({
    action: z.literal('learn'),
    draftId: WritingDraftId.optional(),
    draftRevision: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal('accept'), draftId: WritingDraftId, draftRevision: z.number().int().positive() }),
  z.object({
    action: z.literal('answer'),
    id: EditId,
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
  original: EditInputSchema.shape.original.optional(),
  revised: EditInputSchema.shape.revised.optional(),
  id: EditId.optional(),
  revision: z.string().optional(),
  option: z.number().int().min(0).max(1).optional(),
  text: z.string().max(4000).optional(),
})

export function createWritingVoiceTools(
  store: WritingDraftStore,
  options: {
    source: string
    drafts?: WritingDraftToolHost
    onQuestion?: (edit: VoiceEditRecord) => Promise<{ option?: number; text?: string } | undefined>
  },
): Record<string, unknown> {
  const { voice, learning } = store
  return {
    [WRITING_VOICE_TOOL]: tool({
      description: `${AGENT_NAME} drafts and revises only the owner's personal communications in their own writing voice: emails, messages, letters, personal posts, and scripts they will deliver. UI copy, product copy, mockups, specifications, documentation, sample dialogue, and other general writing belong directly in chat; do not draft, revise, accept, or learn from them here. Learn only from the owner's accepted edits to their own communications by saving one original/revised example and asking one question with two answer choices. The same rules and confirmed lessons serve Chat and Outbox. Refer to this agent as ${AGENT_NAME}.`,
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
                // A terminal keeps no frames, so the edit becomes a draft here and its question is asked at once.
                const captured = await learning.capture({ ...input, source: options.source })
                let edit = captured ? await learning.prepare(captured.edit) : undefined
                if (edit?.question && !edit.answer && options.onQuestion) {
                  const answer = await options.onQuestion(edit)
                  if (answer) edit = await learning.answer(edit.id, edit.revision, answer)
                }
                return {
                  success: true,
                  edit,
                  message: edit
                    ? 'Your edit is saved with its draft. The learning question is available in the interface.'
                    : 'Nothing new to learn from.',
                }
              }
              case 'answer':
                return { success: true, edit: await learning.answer(input.id, input.revision, input) }
              case 'compact':
                return { success: true, ...(await voice.compact()) }
            }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? apiErrorMessage(error) : `${AGENT_NAME} could not complete this step.`,
            }
          }
        }),
    }),
  }
}
