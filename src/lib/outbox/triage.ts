import { generateObject } from 'ai'
import { z } from 'zod'
import type { VoiceWriter } from '#lib/writingVoice/types.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { MAX_ANALYSIS_INPUT_CHARS, type AnalysisCache } from './analysisCache.ts'
import { prepareConversationHistory } from './history.ts'
import { outboxModel, OUTBOX_MODEL_TIMEOUT_MS } from './model.ts'
import { dayRange } from './range.ts'
import { REQUEST_PLAN_PROMPT } from './requestAttention.ts'
import { RequestId, requestNeedsReply, type RequestRecord } from './requestTypes.ts'
import { reviewBrief } from './reviewBrief.ts'
import type { Propose } from './scan.ts'
import {
  MAX_OUTBOX_DRAFT_CHARS,
  ReplyOptionSchema,
  type ComposeReply,
  type Conversation,
  type DraftProposal,
  type Review,
} from './types.ts'

const PROMPT = new URL('./prompts/triage.prompt.md', import.meta.url).pathname
const COMPOSE_PROMPT = new URL('./prompts/compose.prompt.md', import.meta.url).pathname
const COVERAGE_PROMPT = new URL('./prompts/reply-coverage.prompt.md', import.meta.url).pathname
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

function requestSources(conversation: Conversation, request: RequestRecord): Conversation['sources'] {
  const seen = new Set<string>()
  return [request.origin, ...request.evidence, ...(request.attention?.evidence ?? [])]
    .filter((cite) => {
      const key = JSON.stringify([cite.ref, cite.quote])
      if (cite.kind !== 'message' || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((cite) => {
      const source = conversation.sources.find((source) => source.ref === cite.ref && source.body.includes(cite.quote))
      if (!source) throw new Error('The request evidence changed before reply planning.')
      const at = source.body.indexOf(cite.quote)
      return {
        ref: source.ref,
        hash: source.hash,
        from: source.from,
        to: source.to,
        body: source.body.slice(Math.max(0, at - 800), at + cite.quote.length + 800),
        ...(cite.at ? { times: [cite.at] } : {}),
      }
    })
}

async function planRequests(input: {
  conversation: Conversation
  requests: RequestRecord[]
  cache: AnalysisCache
  today: string
  ownerContext: string
  preferences: string
  examples: Review[]
  model: () => ResolvedModel
  write?: VoiceWriter
}): Promise<DraftProposal> {
  const pending = input.requests.filter(requestNeedsReply)
  if (!pending.length) {
    const resolved = input.requests.find(
      (request) => request.status === 'resolved' && request.resolution?.kind === 'message',
    )
    return {
      action: 'ignore',
      title: 'No reply needed from you',
      situation: '',
      reasoning:
        input.requests.length === 1
          ? (input.requests[0].attention?.explanation ?? 'The selected request is resolved or archived.')
          : input.requests.length
            ? 'The selected activity does not leave a response or decision with you.'
            : 'No request for you falls in the selected activity.',
      questions: [],
      draft: '',
      requestPlans: [],
      responseEvidence: resolved ? { ref: resolved.resolution!.ref, quote: resolved.resolution!.quote } : null,
    }
  }
  const instructions = renderPromptFile(await readPromptFile(REQUEST_PLAN_PROMPT), REQUEST_PLAN_PROMPT, {}).output
  const planned: {
    request: RequestRecord
    proposal: DraftProposal
    destination: 'source_conversation' | 'separate_conversation'
  }[] = []
  for (const request of pending) {
    const sources = requestSources(input.conversation, request)
    // Whole-capture hashes and range membership are not semantic changes to this request's reply plan.
    const grounded = sources.map(({ hash: _hash, ...source }) => source)
    const result = await input.cache.run({
      kind: 'plan',
      model: input.model(),
      schema: Judgment.extend({
        action: z.enum(['draft', 'decision']),
        coveredRequests: z.array(RequestId),
        destination: z.enum(['source_conversation', 'separate_conversation']),
      }),
      instructions,
      input: {
        today: input.today,
        ownerContext: input.ownerContext,
        preferences: input.preferences,
        examples: input.write ? [] : writingExamples(input.examples),
        request: {
          id: request.id,
          summary: request.summary,
          origin: request.origin,
          status: request.status,
          explanation: request.explanation,
          context: request.context,
          evidence: request.evidence,
          attention: request.attention,
        },
        conversation: { key: input.conversation.key, medium: input.conversation.medium, sources: grounded },
      },
      validate: (value) => {
        if (value.coveredRequests.length !== 1 || value.coveredRequests[0] !== request.id)
          throw new Error('The reply plan did not account for its request. Check again.')
        checked(value)
      },
    })
    planned.push({ request, proposal: checked(result), destination: result.destination })
  }
  const decisions = planned.filter(({ proposal }) => proposal.action === 'decision')
  const brief = await reviewBrief(planned, input.cache, input.model, input.today)
  const draft = decisions.length ? '' : planned.map(({ proposal }) => proposal.draft).join('\n\n')
  if (draft.length > MAX_OUTBOX_DRAFT_CHARS)
    throw new Error(
      'The complete reply exceeds 40,000 characters. All request assessments are saved; review this conversation in smaller reply groups.',
    )
  // The brief merges the owner's questions across requests and offers shared reply options.
  // Each request keeps its own questions inside requestPlans.
  const proposal: DraftProposal = {
    action: decisions.length ? 'decision' : 'draft',
    ...brief,
    recommendation: decisions
      .map(({ proposal }) => proposal.recommendation)
      .filter(Boolean)
      .join('\n\n'),
    draft,
    requestPlans: planned.map(({ request, proposal, destination }) => ({
      id: request.id,
      response: {
        action: proposal.action as 'draft' | 'decision',
        destination,
        draft: proposal.draft,
        questions: proposal.questions,
        explanation: proposal.reasoning,
      },
    })),
  }
  if (proposal.action === 'draft' && input.write) {
    proposal.draft = (
      await input.write({
        meaning: proposal.draft,
        medium: input.conversation.medium,
        context: proposal.situation,
        instruction:
          'Combine these grounded answers into one coherent reply. Preserve every answer, qualification, and requested next step. Use one opening and closing at most.',
      })
    ).draft
    if (!proposal.draft.trim() || proposal.draft.length > MAX_OUTBOX_DRAFT_CHARS)
      throw new Error('The shared writer did not return a complete reply within the supported message size.')
    const coverageInstructions = renderPromptFile(await readPromptFile(COVERAGE_PROMPT), COVERAGE_PROMPT, {}).output
    for (const part of planned) {
      const coverageInput = {
        request: { id: part.request.id, summary: part.request.summary, origin: part.request.origin },
        plannedAnswer: part.proposal.draft,
        reply: proposal.draft,
      }
      if (JSON.stringify(coverageInput).length > MAX_ANALYSIS_INPUT_CHARS) {
        proposal.draft = draft
        break
      }
      const coverage = await input.cache.run({
        kind: 'coverage',
        model: input.model(),
        instructions: coverageInstructions,
        input: coverageInput,
        schema: z.object({ id: RequestId, covered: z.boolean(), explanation: z.string().max(1200) }),
        validate: (value) => {
          if (value.id !== part.request.id) throw new Error('The final reply check did not account for its request.')
        },
      })
      if (!coverage.covered) {
        // Prefer the complete grounded answers when polishing drops or changes an answer.
        proposal.draft = draft
        break
      }
    }
  }
  return proposal
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
    requests,
    requestCache,
  }) => {
    if (requests) {
      if (!requestCache) throw new Error('The request analysis checkpoint store is unavailable.')
      return planRequests({
        conversation,
        requests,
        cache: requestCache,
        today,
        ownerContext,
        preferences,
        examples,
        model,
        write,
      })
    }
    const context = {
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
    }
    const history = await prepareConversationHistory(conversation, context, model)
    const judgment = await generateObject({
      ...model(),
      schema: Judgment.extend({
        responseEvidence: z
          .object({ ref: z.string(), quote: z.string().min(1).max(4000) })
          .nullable()
          .optional(),
      }),
      instructions: renderPromptFile(await readPromptFile(PROMPT), PROMPT, {}).output,
      prompt: JSON.stringify({ ...context, ...history }),
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
    const context = {
      today: now.date,
      checkedAtUtc: now.toUTC().normalize().plainDateTime.toString(),
      ownerContext,
      preferences,
      examples: write ? [] : writingExamples(examples),
      ownerInstruction: instruction,
      previousOwnerDirections: item.replyDirections?.slice(-6),
      currentDraft: draft,
      situation: item.situation,
      questions: item.questions,
      recommendation: item.recommendation,
      workstreams: item.workstreams,
      recipient: item.recipient,
      followupOf: item.followupOf,
    }
    const history = await prepareConversationHistory(item.conversation, context, model)
    const result = await generateObject({
      ...model(),
      schema: Judgment.extend({ action: z.enum(['draft', 'decision']) }),
      instructions: renderPromptFile(await readPromptFile(COMPOSE_PROMPT), COMPOSE_PROMPT, {}).output,
      prompt: JSON.stringify({ ...context, ...history }),
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
