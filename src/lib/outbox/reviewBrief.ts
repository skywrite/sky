import { z } from 'zod'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { AnalysisCache } from './analysisCache.ts'
import { REVIEW_BRIEF_PROMPT } from './requestAttention.ts'
import type { RequestRecord } from './requestTypes.ts'
import { ReplyOptionSchema, type DraftProposal } from './types.ts'

const Brief = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(280),
  situation: z.string().min(1).max(1600),
  explanation: z.string().min(1).max(1200),
  questions: z.array(z.string().min(1).max(500)).max(4).default([]),
  replyOptions: z.array(ReplyOptionSchema).max(4).default([]),
})

export type ReviewBrief = Pick<DraftProposal, 'title' | 'summary' | 'situation' | 'reasoning' | 'questions'> & {
  replyOptions: NonNullable<DraftProposal['replyOptions']>
}

/** Exact repeats are dropped here; merging paraphrases is the brief's job. */
function distinct(questions: string[]): string[] {
  const seen = new Set<string>()
  return questions.filter((question) => {
    const key = question.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Summarize already completed plans for presentation; the full request/answer accounting stays separate.
 * When any plan is a decision, the brief also carries one question per distinct decision and shared reply options.
 */
export async function reviewBrief(
  planned: { request: RequestRecord; proposal: DraftProposal }[],
  cache: AnalysisCache,
  model: () => ResolvedModel,
  today: string = PlainDate.today().toString(),
): Promise<ReviewBrief> {
  const instructions = renderPromptFile(await readPromptFile(REVIEW_BRIEF_PROMPT), REVIEW_BRIEF_PROMPT, {}).output
  let previous: z.infer<typeof Brief> | null = null
  let decided = false
  const remaining = planned.map(({ request, proposal }) => ({
    title: proposal.title,
    action: proposal.action,
    situation: proposal.situation,
    questions: proposal.questions,
    recommendation: proposal.recommendation ?? '',
    replyOptions: proposal.replyOptions ?? [],
    whyYou: request.attention?.explanation ?? proposal.reasoning,
  }))
  while (remaining.length) {
    const plans: (typeof remaining)[number][] = []
    let size = 0
    while (remaining.length && (plans.length === 0 || size + JSON.stringify(remaining[0]).length <= 20_000)) {
      const plan = remaining.shift()!
      plans.push(plan)
      size += JSON.stringify(plan).length
    }
    decided ||= plans.some((plan) => plan.action === 'decision')
    previous = await cache.run({
      kind: 'brief',
      model: model(),
      schema: Brief,
      instructions,
      repairValidation: true,
      input: { today, previous, plans },
      validate: (value) => {
        if (/^\d+\s+requests?\b/i.test(value.title))
          throw new Error('The review needs a specific subject, not a request count.')
        if (decided && !distinct(value.questions).length)
          throw new Error('The review must state the decision the owner still needs to make.')
      },
    })
  }
  return {
    title: previous!.title,
    summary: previous!.summary,
    situation: previous!.situation,
    reasoning: previous!.explanation,
    questions: decided ? distinct(previous!.questions) : [],
    replyOptions: decided ? previous!.replyOptions : [],
  }
}
