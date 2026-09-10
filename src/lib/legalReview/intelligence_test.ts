import { rm } from 'node:fs/promises'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { assert, test } from '#test'
import { analyzeAgreements } from './intelligence.ts'
import { reviewFixture, REVIEW_CONTEXT, scriptedAnalysis } from './testHelpers.ts'
import type { Analysis } from './types.ts'

test('agreement analysis streams all originals and saves only its validated final result', async () => {
  let analysis: Analysis
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV4StreamPart>({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'review' },
          { type: 'text-delta', id: 'review', delta: JSON.stringify(analysis).slice(0, 100) },
          { type: 'text-delta', id: 'review', delta: JSON.stringify(analysis).slice(100) },
          { type: 'text-end', id: 'review' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 100, text: 100, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  })
  const fixture = await reviewFixture((input) => {
    analysis = scriptedAnalysis(input)
    return analyzeAgreements(input, { model: { model } })
  })
  try {
    const progress: string[] = []
    const result = await fixture.reviewer.review({ sources: fixture.sources, context: REVIEW_CONTEXT }, (line) =>
      progress.push(line),
    )
    const request = model.doStreamCalls[0]!
    assert({
      given: 'a five-document review delivered in response chunks',
      should: 'use one streaming call, include the native PDF, and persist complete validated findings',
      actual: {
        streamingCalls: model.doStreamCalls.length,
        nonStreamingCalls: model.doGenerateCalls.length,
        pdf: request.prompt.some(
          (message) =>
            message.role === 'user' &&
            message.content.some((part) => part.type === 'file' && part.mediaType === 'application/pdf'),
        ),
        reviewed: result.documents.filter((document) => document.status === 'reviewed').length,
        findings: (await fixture.store.read(result.id))?.findings.length,
        comparison: result.comparison.status,
        receiving: progress.some((line) => line.startsWith('Receiving the analysis')),
      },
      expected: {
        streamingCalls: 1,
        nonStreamingCalls: 0,
        pdf: true,
        reviewed: 5,
        findings: 1,
        comparison: 'current',
        receiving: true,
      },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('an interrupted analysis retains the originals without persisting incomplete streamed findings or retrying', async () => {
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'text-start', id: 'review' })
          controller.enqueue({ type: 'text-delta', id: 'review', delta: '{"title":"Unfinished review", "findings":[' })
          abortSignal!.addEventListener('abort', () => controller.error(abortSignal!.reason), { once: true })
        },
      }),
    }),
  })
  const fixture = await reviewFixture((input) => analyzeAgreements(input, { model: { model }, timeoutMs: 30 }))
  try {
    let id = ''
    const failure = await fixture.reviewer
      .review({
        sources: fixture.sources,
        context: REVIEW_CONTEXT,
        onCreated: async (value) => {
          id = value
        },
      })
      .then(
        () => '',
        (error: Error) => error.message,
      )
    const saved = (await fixture.store.read(id))!
    assert({
      given: 'the deadline interrupts an incomplete model response',
      should: 'surface the timeout, retain all five originals and leave no partial findings behind',
      actual: {
        timeout: failure.includes('timed out'),
        nextStep: failure.includes('action=status'),
        calls: model.doStreamCalls.length,
        documents: saved.documents.length,
        reviewed: saved.documents.filter((document) => document.status === 'reviewed').length,
        findings: saved.findings.length,
        errorSaved: saved.lastError === failure,
      },
      expected: { timeout: true, nextStep: true, calls: 1, documents: 5, reviewed: 0, findings: 0, errorSaved: true },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
