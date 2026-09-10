import * as path from 'node:path'
import LegalReviewTask from '#commands/all/legal/review.ts'
import { runToolCommand } from '#commands/lib/chat/notebookTools.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import type CommandService from '#commands/lib/core/CommandService.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import * as config from '#config'
import { LegalReviewer } from '#lib/legalReview/agent.ts'
import { legalReviewBrief, legalReviewContext } from '#lib/legalReview/chat.ts'
import { createLegalReviewer } from '#lib/legalReview/runtime.ts'
import { REVIEW_CONTEXT, scriptedAnalysis } from '#lib/legalReview/testHelpers.ts'
import type { ReviewContext } from '#lib/legalReview/types.ts'
import { replyThreadTestHost } from './replyThreadsTestHelpers.ts'

/** Real command, attachment, review and chat persistence; only the two model responses are scripted. */
export function legalReviewTestHost(root: string, calls: ReviewContext[] = []) {
  const settings = {
    ...config,
    DIR_BASE: root,
    DIR_TIME: path.join(root, 'time'),
    DIR_STATE: path.join(root, 'state'),
    DIR_ATTACHMENTS: path.join(root, 'attachments'),
  }
  const store = createLegalReviewer(settings).store
  const reviewer = new LegalReviewer(store, async (input) => {
    calls.push(input.context)
    return scriptedAnalysis(input)
  })
  const task = new LegalReviewTask(() => reviewer)
  const context = CommandContext.test(settings).fork({ output: new BufferedOutput() })
  const tasks = {
    run: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'legal:review') throw new Error(`Unexpected external action: ${name}`)
      return task.run({ args, context, tasks } as unknown as Parameters<LegalReviewTask['run']>[0])
    },
  } as unknown as CommandService
  let report = ''
  return {
    ...replyThreadTestHost(root, {
      systemPrompt: REVIEW_CONTEXT.instructions,
      tools: async (hooks) => {
        const bridge = legalReviewContext(hooks, settings.DIR_ATTACHMENTS, 'chat:fixture')
        const latest = hooks.context.conversation.at(-1)?.content ?? ''
        const status = /draft|shorter/i.test(latest)
        const result = await runToolCommand(
          tasks,
          { commandName: 'legal:review', toolName: 'legal_review' },
          { action: status ? 'status' : 'review', expected: 5 },
          { legalReviewContext: bridge },
        )
        if (!result.success) throw new Error(String(result.error))
        report = status
          ? 'Dear team, please align the cancellation terms across the five agreements.'
          : String(result.report)
        return { tools: {}, toolApproval: {}, instructions: await legalReviewBrief(hooks, settings) }
      },
      invokeModel: async (args) => {
        args.sink.write(report)
        return { text: report, content: [], steps: [], responseMessages: [{ role: 'assistant', content: report }] }
      },
    }),
    legalReviews: store,
  }
}
