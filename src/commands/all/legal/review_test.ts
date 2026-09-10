import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { getAIChatToolOptions } from '#commands/lib/AIChatTool.ts'
import { runToolCommand } from '#commands/lib/chat/notebookTools.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import type CommandService from '#commands/lib/core/CommandService.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import * as config from '#config'
import { reviewFixture, REVIEW_CONTEXT, scriptedAnalysis } from '#lib/legalReview/testHelpers.ts'
import { assert, test } from '#test'
import LegalAnnotateTask from './annotate.ts'
import LegalReviewTask from './review.ts'

test('legal:review uses trusted chat context, keeps one review and makes zero Google calls', async () => {
  const fixture = await reviewFixture()
  try {
    const context = CommandContext.test({
      ...config,
      DIR_BASE: fixture.root,
      DIR_TIME: path.join(fixture.root, 'time'),
      DIR_STATE: path.join(fixture.root, 'state'),
    }).fork({ output: new BufferedOutput() })
    const task = new LegalReviewTask(() => fixture.reviewer)
    const called: string[] = []
    let linked: string | undefined
    const tasks = {
      run: async (name: string, args: Record<string, unknown>) => {
        called.push(name)
        if (name !== 'legal:review') throw new Error('Unexpected external action')
        return task.run({ args, context, tasks } as unknown as Parameters<LegalReviewTask['run']>[0])
      },
    } as unknown as CommandService
    const options = {
      legalReviewContext: {
        id: () => linked,
        link: async (id: string) => {
          linked = id
        },
        sources: () => fixture.sources,
        context: REVIEW_CONTEXT,
      },
    }
    const first = await runToolCommand(
      tasks,
      { commandName: 'legal:review', toolName: 'legal_review' },
      { expected: 5 },
      options,
    )
    const status = await runToolCommand(
      tasks,
      { commandName: 'legal:review', toolName: 'legal_review' },
      { action: 'status' },
      options,
    )
    assert({
      given: 'a five-file chat review followed by a status request',
      should: 'use a single saved review with no upload or annotation call',
      actual: {
        success: first.success,
        same: first.reviewId === status.reviewId && linked === first.reviewId,
        calls: called,
        reviewApproval: getAIChatToolOptions(LegalReviewTask)?.needsApproval,
        annotateApproval: getAIChatToolOptions(LegalAnnotateTask)?.needsApproval,
        source: (await fixture.store.read(linked!))?.source,
      },
      expected: {
        success: true,
        same: true,
        calls: ['legal:review', 'legal:review'],
        reviewApproval: false,
        annotateApproval: true,
        source: 'chat:mock-review',
      },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('legal:review rejects Google URLs and malformed selections without creating a review', async () => {
  const fixture = await reviewFixture()
  try {
    const context = CommandContext.test(config).fork({ output: new BufferedOutput() })
    const task = new LegalReviewTask(() => fixture.reviewer)
    const run = (args: Record<string, unknown>) =>
      task.run({ args, context } as unknown as Parameters<LegalReviewTask['run']>[0])
    const results = await Promise.all([
      run({ document: 'https://docs.google.com/document/d/mock-document/edit' }),
      run({ documents: '[1]' }),
      run({ action: 'status' }),
    ])
    assert({
      given: 'requests that cannot perform a local review',
      should: 'return actionable failures without falling through to annotation',
      actual: results.map((result) => result.status),
      expected: ['fail', 'fail', 'fail'],
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('a failed legal analysis cannot restart in the same chat turn, and a later request reuses the saved set', async () => {
  let analyses = 0
  const fixture = await reviewFixture(async (input) => {
    if (++analyses === 1) throw new Error('Mock analysis timed out.')
    return scriptedAnalysis(input)
  })
  try {
    const output = new BufferedOutput()
    const context = CommandContext.test(config).fork({ output })
    const task = new LegalReviewTask(() => fixture.reviewer)
    const tasks = {
      run: (_name: string, args: Record<string, unknown>) =>
        task.run({ args, context } as unknown as Parameters<LegalReviewTask['run']>[0]),
    } as unknown as CommandService
    let linked: string | undefined
    const envelope = {
      id: () => linked,
      link: async (id: string) => {
        linked = id
      },
      sources: () => fixture.sources,
      context: REVIEW_CONTEXT,
    }
    const entry = { commandName: 'legal:review', toolName: 'legal_review' }
    const run = (input: Record<string, unknown>) =>
      runToolCommand(tasks, entry, input, { legalReviewContext: envelope })
    const first = await run({ expected: 5 })
    const repeat = await run({ focus: 'Reworded priorities for the same agreements' })
    const status = await run({ action: 'status' })
    assert({
      given: 'a timeout followed by a model-authored retry with different wording',
      should: 'block the repeat before model work and make retained originals available through status',
      actual: {
        analyses,
        first: first.success,
        retryable: first.retryable,
        retained: String(first.error).includes('5 original agreements'),
        repeat: repeat.success,
        blocked: String(repeat.error).includes('already failed in this turn'),
        status: status.success,
        linked: status.reviewId === linked,
        documents: (await fixture.store.read(linked!))?.documents.length,
      },
      expected: {
        analyses: 1,
        first: false,
        retryable: false,
        retained: true,
        repeat: false,
        blocked: true,
        status: true,
        linked: true,
        documents: 5,
      },
    })
    const next = await runToolCommand(
      tasks,
      entry,
      {},
      {
        legalReviewContext: {
          ...envelope,
          context: {
            ...REVIEW_CONTEXT,
            conversation: [
              ...REVIEW_CONTEXT.conversation,
              { role: 'user', content: 'Try the review again using the saved agreements.' },
            ],
          },
        },
      },
    )
    assert({
      given: 'another user turn requesting a new attempt',
      should: 'complete against the same retained review without duplicate documents',
      actual: {
        analyses,
        success: next.success,
        id: next.reviewId,
        documents: (await fixture.store.read(linked!))?.documents.length,
      },
      expected: { analyses: 2, success: true, id: linked, documents: 5 },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
