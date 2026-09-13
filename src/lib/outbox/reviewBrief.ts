import { z } from 'zod'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { AnalysisCache } from './analysisCache.ts'
import { REVIEW_BRIEF_PROMPT } from './requestAttention.ts'
import type { RequestRecord } from './requestTypes.ts'
import type { DraftProposal } from './types.ts'

const Brief = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(280),
  situation: z.string().min(1).max(1600),
  explanation: z.string().min(1).max(1200),
})

/** Summarize already completed plans for presentation; the full request/answer accounting stays separate. */
export async function reviewBrief(
  planned: { request: RequestRecord; proposal: DraftProposal }[],
  cache: AnalysisCache,
  model: () => ResolvedModel,
  today: string = PlainDate.today().toString(),
): Promise<Pick<DraftProposal, 'title' | 'summary' | 'situation' | 'reasoning'>> {
  const instructions = renderPromptFile(await readPromptFile(REVIEW_BRIEF_PROMPT), REVIEW_BRIEF_PROMPT, {}).output
  let previous: z.infer<typeof Brief> | null = null
  const remaining = planned.map(({ request, proposal }) => ({
    title: proposal.title,
    situation: proposal.situation,
    questions: proposal.questions,
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
    previous = await cache.run({
      kind: 'brief',
      model: model(),
      schema: Brief,
      instructions,
      input: { today, previous, plans },
      validate: (value) => {
        if (/^\d+\s+requests?\b/i.test(value.title))
          throw new Error('The review needs a specific subject, not a request count.')
      },
    })
  }
  return {
    title: previous!.title,
    summary: previous!.summary,
    situation: previous!.situation,
    reasoning: previous!.explanation,
  }
}
