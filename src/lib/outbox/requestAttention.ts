import { z } from 'zod'
import type { ResolvedModel } from '#shared/ai/models.ts'
import AboutMe from '#shared/models/AboutMe/document/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { AnalysisCache, modelVersion } from './analysisCache.ts'
import { hash } from './files.ts'
import { conversationChunks } from './history.ts'
import { RequestAttentionSchema, RequestId, type RequestCitation, type RequestRecord } from './requestTypes.ts'
import type { Conversation } from './types.ts'

const ATTENTION = new URL('./prompts/request-attention.prompt.md', import.meta.url).pathname
export const REQUEST_PLAN_PROMPT = new URL('./prompts/request-plan.prompt.md', import.meta.url).pathname
export const REVIEW_BRIEF_PROMPT = new URL('./prompts/review-brief.prompt.md', import.meta.url).pathname
export type OwnerInitiative = { ref: string; title: string; context: string }
type Witness = RequestCitation & { text: string; ownerAuthored: boolean }
const Citation = z.object({ ref: z.string(), message: z.string(), quote: z.string().min(1).max(2000) })
const Attention = z.object({
  id: RequestId,
  action: z.enum(['reply', 'waiting', 'none']),
  basis: z.enum(['direct_request', 'active_exchange', 'owner_commitment', 'initiative_decision', 'none']),
  explanation: z.string().min(1).max(1200),
  evidence: z.array(Citation).max(4),
  initiative: z.string().nullable(),
})

function witnesses(conversation: Conversation, request: RequestRecord, ownerNames: string[]): Witness[] {
  const parts = conversationChunks(conversation).flat()
  const result: Witness[] = []
  const add = (part: (typeof parts)[number], quote?: string) => {
    if (
      result.some(
        (witness) =>
          witness.ref === part.ref && witness.message === part.message.key && (!quote || witness.text.includes(quote)),
      )
    )
      return
    const at = quote ? part.body.indexOf(quote) : 0
    if (at < 0) return
    const text = part.body.slice(Math.max(0, at - 700), at + (quote?.length ?? 1400) + 700)
    const author = /\*\*(.+?)\*\*/
      .exec(part.heading ?? '')?.[1]
      .trim()
      .toLowerCase()
    result.push({
      kind: 'message',
      ref: part.ref,
      message: part.message.key,
      heading: part.heading,
      at: part.message.at,
      quote: quote ?? text.slice(0, 2000),
      text,
      ownerAuthored: ownerNames.some((name) => name.toLowerCase() === author),
    })
  }
  for (const cite of [request.origin, ...request.evidence]) {
    if (cite.kind !== 'message') continue
    const part = parts.find(
      (part) => part.ref === cite.ref && part.message.key === cite.message && part.body.includes(cite.quote),
    )
    if (part) add(part, cite.quote)
  }
  const ownerParts = parts.filter((part) => {
    const author = /\*\*(.+?)\*\*/
      .exec(part.heading ?? '')?.[1]
      .trim()
      .toLowerCase()
    return ownerNames.some((name) => name.toLowerCase() === author)
  })
  // Supply actual participation evidence even when it is outside the request's date range.
  for (const part of [...ownerParts.slice(0, 2), ...ownerParts.slice(-6)]) add(part)
  return result
}

export function createRequestAttention(options: {
  ownerContext: string
  initiatives?: OwnerInitiative[]
  today?: string
  model: () => ResolvedModel
}) {
  const initiatives = options.initiatives ?? []
  const me = AboutMe.fromMarkdown(options.ownerContext)
  const ownerNames = [...new Set([me.fullName, me.firstName].filter(Boolean))]
  const names = ownerNames.map(
    (name) =>
      new RegExp(`(^|[^\\p{L}\\p{N}_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_])`, 'iu'),
  )
  const prompts = Promise.all(
    [ATTENTION, REQUEST_PLAN_PROMPT, REVIEW_BRIEF_PROMPT].map(
      async (file) => renderPromptFile(await readPromptFile(file), file, {}).output,
    ),
  )
  return {
    version: async () =>
      hash(
        JSON.stringify([
          'owner-attention-v1',
          options.ownerContext,
          initiatives,
          options.today,
          modelVersion(options.model()),
          await prompts,
        ]),
      ),
    assess: async (
      conversation: Conversation,
      records: RequestRecord[],
      cache: AnalysisCache,
    ): Promise<RequestRecord[]> => {
      const [instructions] = await prompts
      const assessed: RequestRecord[] = []
      for (const request of records) {
        if (!request.present || request.status === 'resolved' || request.status === 'dismissed') {
          assessed.push({
            ...request,
            attention: { action: 'none', basis: 'none', explanation: request.explanation, evidence: [] },
          })
          continue
        }
        const sources = witnesses(conversation, request, ownerNames)
        const participants = [
          ...new Map(conversation.sources.map(({ from, to }) => [JSON.stringify([from, to]), { from, to }])).values(),
        ]
        const result = await cache.run({
          kind: 'attention',
          model: options.model(),
          instructions,
          schema: Attention,
          repairValidation: true,
          input: {
            today: options.today,
            ownerContext: options.ownerContext,
            ownerNames,
            initiatives,
            candidate: {
              id: request.id,
              summary: request.summary,
              origin: request.origin,
              status: request.status,
              explanation: request.explanation,
              context: request.context,
            },
            conversation: { key: conversation.key, medium: conversation.medium, participants, sources },
          },
          validate: (value) => {
            if (value.id !== request.id) throw new Error('The relevance check did not identify its request.')
            if (value.action === 'reply' && (value.basis === 'none' || !value.evidence.length))
              throw new Error('A request needs evidence that the owner owes a response before entering Outbox.')
            if (value.basis === 'initiative_decision' && !initiatives.some(({ ref }) => ref === value.initiative))
              throw new Error('The relevance check cited an unknown owner initiative.')
            for (const cite of value.evidence)
              if (
                !cite.quote.trim() ||
                !sources.some(
                  (source) =>
                    source.ref === cite.ref && source.message === cite.message && source.text.includes(cite.quote),
                )
              )
                throw new Error('The relevance check cited evidence it did not review.')
            if (
              value.action === 'reply' &&
              value.basis === 'direct_request' &&
              ownerNames.length &&
              conversation.medium === 'Slack' &&
              !participants.some(({ to }) => /^DM with /i.test(to) || names.some((name) => name.test(to))) &&
              !value.evidence.some((cite) => names.some((name) => name.test(cite.quote)))
            )
              throw new Error('A direct channel request needs evidence that it addresses the owner.')
            if (
              value.action === 'reply' &&
              ownerNames.length &&
              ['active_exchange', 'owner_commitment'].includes(value.basis) &&
              !value.evidence.some((cite) =>
                sources.some(
                  (source) =>
                    source.ownerAuthored &&
                    source.ref === cite.ref &&
                    source.message === cite.message &&
                    source.text.includes(cite.quote),
                ),
              )
            )
              throw new Error('The relevance check needs the owner’s actual participation or promise as evidence.')
          },
        })
        const initiative = initiatives.find(({ ref }) => ref === result.initiative)
        const evidence = result.evidence.map((cite) => {
          const source = sources.find(
            (source) => source.ref === cite.ref && source.message === cite.message && source.text.includes(cite.quote),
          )!
          const { text: _text, ownerAuthored: _ownerAuthored, ...witness } = source
          return { ...witness, quote: cite.quote }
        })
        assessed.push({
          ...request,
          attention: RequestAttentionSchema.parse({
            ...result,
            evidence,
            ...(initiative
              ? { initiative: { ref: initiative.ref, title: initiative.title } }
              : { initiative: undefined }),
          }),
        })
      }
      return assessed
    },
  }
}
