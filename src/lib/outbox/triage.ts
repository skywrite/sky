import { generateObject } from 'ai'
import { z } from 'zod'
import type { VoiceWriter } from '#lib/writingVoice/types.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { outboxModel, OUTBOX_MODEL_TIMEOUT_MS } from './model.ts'
import { dayRange } from './range.ts'
import type { Propose } from './scan.ts'
import { ReplyOptionSchema, type ComposeReply, type DraftProposal, type Review } from './types.ts'

const PROMPT = new URL('./prompts/triage.prompt.md', import.meta.url).pathname
const COMPOSE_PROMPT = new URL('./prompts/compose.prompt.md', import.meta.url).pathname
const Judgment = z.object({
  action: z.enum(['ignore', 'draft', 'decision']),
  title: z.string().min(1).max(160),
  situation: z.string().max(1600),
  explanation: z
    .string()
    .min(1)
    .max(1600)
    .describe('A brief user-facing explanation of the proposed reply or remaining question.'),
  questions: z.array(z.string().max(500)).max(6),
  recommendation: z.string().max(1200),
  replyOptions: z.array(ReplyOptionSchema).max(4),
  draft: z.string().max(8000),
})

function checked(result: z.infer<typeof Judgment> & Pick<DraftProposal, 'responseEvidence'>): DraftProposal {
  const { explanation, ...fields } = result
  const proposal: DraftProposal = { ...fields, reasoning: explanation }
  if (proposal.action === 'draft' && !proposal.draft.trim())
    throw new Error('Sky returned an empty proposed reply. Try again.')
  if (proposal.action === 'ignore')
    return { ...proposal, draft: '', questions: [], recommendation: '', replyOptions: [] }
  if (proposal.action === 'decision' && !proposal.questions.length)
    throw new Error('Sky did not explain what information the reply needs. Try again.')
  return { ...proposal, draft: proposal.action === 'decision' ? '' : proposal.draft.trim() }
}

function writingExamples(examples: Review[]) {
  return examples
    .filter((example) => example.original.trim() && example.final.trim())
    .slice(0, 4)
    .map(({ original, final }) => ({ original: original.slice(0, 1500), final: final.slice(0, 1500) }))
}

/** Ground the reply in the conversation, then apply the shared writing voice. */
export function createTriage(
  ownerContext: string,
  model: () => ResolvedModel = outboxModel,
  write?: VoiceWriter,
): Propose {
  return async ({
    conversation,
    preferences,
    examples,
    today,
    now,
    range = dayRange(today),
    triggerSources,
    priorResponse,
  }) => {
    const judgment = await generateObject({
      ...model(),
      schema: Judgment.extend({
        responseEvidence: z
          .object({ ref: z.string(), quote: z.string().min(1).max(4000) })
          .nullable()
          .optional(),
      }),
      instructions: renderPromptFile(await readPromptFile(PROMPT), PROMPT, {}).output,
      prompt: JSON.stringify({
        today,
        checkedAtUtc: now,
        ownerContext,
        preferences,
        examples: write ? [] : writingExamples(examples),
        searchRange: { ...range, clock: 'Notebook message timestamps; both endpoint minutes are included.' },
        triggerSources:
          triggerSources ??
          conversation.sources.filter((source) => source.ref.startsWith(`${today}/`)).map(({ ref }) => ref),
        priorResponse,
        conversation,
      }),
      abortSignal: AbortSignal.timeout(OUTBOX_MODEL_TIMEOUT_MS),
    })
    const proposal = checked(judgment.object)
    if (proposal.action === 'draft' && write)
      proposal.draft = (
        await write({
          meaning: proposal.draft,
          medium: conversation.medium,
          context: proposal.situation,
        })
      ).draft
    return proposal
  }
}

export function createReplyComposer(
  ownerContext: string,
  model: () => ResolvedModel = outboxModel,
  write?: VoiceWriter,
): ComposeReply {
  return async ({ item, draft, instruction, preferences, examples }) => {
    const now = new ZonedDateTime()
    const result = await generateObject({
      ...model(),
      schema: Judgment.extend({ action: z.enum(['draft', 'decision']) }),
      instructions: renderPromptFile(await readPromptFile(COMPOSE_PROMPT), COMPOSE_PROMPT, {}).output,
      prompt: JSON.stringify({
        today: now.date,
        checkedAtUtc: now.toUTC().normalize().plainDateTime.toString(),
        ownerContext,
        preferences,
        examples: write ? [] : writingExamples(examples),
        ownerInstruction: instruction,
        previousOwnerDirections: item.replyDirections?.slice(-6),
        currentDraft: draft,
        conversation: item.conversation,
        situation: item.situation,
        questions: item.questions,
        recommendation: item.recommendation,
        recipient: item.recipient,
        followupOf: item.followupOf,
      }),
      abortSignal: AbortSignal.timeout(OUTBOX_MODEL_TIMEOUT_MS),
    })
    const proposal = checked(result.object)
    if (proposal.action === 'draft' && write)
      proposal.draft = (
        await write({
          meaning: proposal.draft,
          medium: item.conversation.medium,
          recipient: item.recipient ?? '',
          context: proposal.situation,
          instruction,
        })
      ).draft
    return proposal
  }
}
