import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { getAIChatToolOptions } from '#commands/lib/AIChatTool.ts'
import { runToolCommand } from '#commands/lib/chat/notebookTools.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import type CommandService from '#commands/lib/core/CommandService.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import * as config from '#config'
import { legalReviewContext, type LegalReviewChatContext } from '#lib/legalReview/chat.ts'
import { agreementPdf, reviewFixture, REVIEW_CONTEXT, scriptedAnalysis } from '#lib/legalReview/testHelpers.ts'
import type { ToolHooks } from '#shared/models/Chat/ChatSession/mod.ts'
import { assert, test } from '#test'
import LegalAnnotateTask from './annotate.ts'
import LegalReviewTask from './review.ts'

/**
 * One web upload as the chat host presents it: the clip on the user's turn carries the name it was uploaded
 * with, the copy in the day's attachments its saved filename. The model is shown both.
 */
async function uploadedAgreement(root: string) {
  const name = 'Atlas Services Agreement.pdf'
  const saved = '2026-02-04_Chat_Atlas-Services-Agreement.pdf'
  const attachments = path.join(root, 'attachments')
  const file = path.join(attachments, '2026', '02', '04', saved)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, agreementPdf('Cancellation requires 90 days notice.'))
  let linked: string | undefined
  /** The host builds this envelope once per user turn; the linked review outlives the turn. */
  const turn = () =>
    legalReviewContext(
      {
        context: {
          instructions: REVIEW_CONTEXT.instructions,
          conversation: [
            {
              role: 'user',
              content: `Review this agreement for Atlas.\n\n[📎 ${name}](/chat/files/2026-02-04/${saved})`,
            },
          ],
        },
        attachments: () => [{ file: saved }],
        legalReview: {
          id: () => linked,
          link: async (id: string) => {
            linked = id
          },
        },
      } as unknown as ToolHooks,
      attachments,
      'chat:mock-review',
    )
  /** The agreements on the review this chat links, by name; none while nothing is linked. */
  const documents = async (store: Awaited<ReturnType<typeof reviewFixture>>['store']) =>
    linked ? (await store.read(linked))?.documents.map((document) => document.name) : []
  return { name, saved, file, turn, documents }
}

/** The real command behind the chat tool boundary; a mistaken relative name resolves inside the fixture. */
function reviewTool(fixture: Awaited<ReturnType<typeof reviewFixture>>) {
  const context = CommandContext.test({
    ...config,
    DIR_HOME: fixture.root,
    DIR_BASE: fixture.root,
    DIR_TIME: path.join(fixture.root, 'time'),
    DIR_STATE: path.join(fixture.root, 'state'),
  }).fork({ output: new BufferedOutput() })
  const task = new LegalReviewTask(() => fixture.reviewer)
  const tasks = {
    run: (_name: string, args: Record<string, unknown>) =>
      task.run({ args, context } as unknown as Parameters<LegalReviewTask['run']>[0]),
  } as unknown as CommandService
  return (input: Record<string, unknown>, turn: LegalReviewChatContext) =>
    runToolCommand(tasks, { commandName: 'legal:review', toolName: 'legal_review' }, input, {
      legalReviewContext: turn,
    })
}

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

test('an uploaded agreement answers to every name the chat shows for it', async () => {
  const fixture = await reviewFixture()
  try {
    const upload = await uploadedAgreement(fixture.root)
    const run = reviewTool(fixture)
    const selected: Record<string, unknown> = {}
    for (const [label, document] of [
      ['the name it was uploaded with', upload.name],
      ['its saved filename', upload.saved],
      ['the path of its saved copy', upload.file],
    ] as const)
      selected[label] = (await run({ document }, upload.turn())).success
    assert({
      given: 'a web upload whose saved filename differs from the name it was uploaded with',
      should: 'select the same agreement by either name or by the path of the saved copy',
      actual: {
        selected,
        documents: await upload.documents(fixture.store),
      },
      expected: {
        selected: {
          'the name it was uploaded with': true,
          'its saved filename': true,
          'the path of its saved copy': true,
        },
        documents: [upload.name],
      },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('a request rejected before analysis leaves the turn open for the corrected call', async () => {
  let analyses = 0
  const fixture = await reviewFixture(async (input) => {
    analyses++
    return scriptedAnalysis(input)
  })
  try {
    const upload = await uploadedAgreement(fixture.root)
    const run = reviewTool(fixture)
    const turn = upload.turn()
    const mistaken = await run({ document: 'no-such-agreement.pdf' }, turn)
    const status = await run({ action: 'status' }, turn)
    const corrected = await run({ document: upload.file }, turn)
    assert({
      given: 'a file the tool cannot find, a status request, then the right file, all in one chat turn',
      should: 'reject the first without ending the turn, say what is waiting, and review the right file',
      actual: {
        mistaken: [mistaken.success, mistaken.retryable],
        waiting: String(status.error),
        corrected: corrected.success,
        analyses,
        documents: await upload.documents(fixture.store),
      },
      expected: {
        mistaken: [false, true],
        waiting: `No review has been saved yet. The attached agreement (${upload.name}) has not been analyzed; run the review to begin.`,
        corrected: true,
        analyses: 1,
        documents: [upload.name],
      },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('a rejected request leaves the saved review alone, and a failed analysis after it still ends the turn', async () => {
  let analyses = 0
  const fixture = await reviewFixture(async (input) => {
    if (++analyses === 2) throw new Error('Mock analysis timed out.')
    return scriptedAnalysis(input)
  })
  try {
    const upload = await uploadedAgreement(fixture.root)
    const run = reviewTool(fixture)
    const reviewed = await run({}, upload.turn())
    const later = upload.turn()
    const mistaken = await run({ document: 'no-such-agreement.pdf' }, later)
    const failed = await run({}, later)
    const repeat = await run({ focus: 'Reworded priorities for the same agreement' }, later)
    assert({
      given: 'a later turn with a file the tool cannot find, then an analysis that times out',
      should: 'report the saved review as untouched, then block further analysis for that turn',
      actual: {
        reviewed: reviewed.success,
        mistaken: [mistaken.success, mistaken.retryable],
        untouched: String(mistaken.error).includes(
          'Nothing was added or analyzed. 1 original agreements and 1 earlier findings are retained',
        ),
        toldToStop: String(mistaken.error).includes('Do not repeat analysis'),
        failed: [failed.success, failed.retryable],
        blocked: String(repeat.error).includes('already failed in this turn'),
        analyses,
      },
      expected: {
        reviewed: true,
        mistaken: [false, true],
        untouched: true,
        toldToStop: false,
        failed: [false, false],
        blocked: true,
        analyses: 2,
      },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
