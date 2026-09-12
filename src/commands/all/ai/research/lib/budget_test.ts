import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { jsonSchema, simulateReadableStream, wrapLanguageModel } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import ChatEngine from '#shared/models/Chat/ChatEngine/mod.ts'
import { assert, test } from '#test'
import { researchBudget, researchBudgetMiddleware, researchEvidenceTokens, researchInputTokens } from './budget.ts'

test('research fits the parent reading budget to its own model window', () => {
  assert({
    given: 'default, closed, small-parent and small-model budgets',
    should: 'preserve the parent constraint and leave room for instructions and output',
    actual: [
      researchBudget().readingTokens,
      researchBudget(0).readingTokens,
      researchBudget(25_000, 1_000_000).readingTokens,
      researchBudget(300_000, 131_072).readingTokens,
    ],
    expected: [300_000, 0, 25_000, 50_000],
  })
})

test('research refuses an oversized mission or tool schema before calling the provider', async () => {
  const middleware = researchBudgetMiddleware(1000)
  const cases: LanguageModelV4CallOptions[] = [
    {
      prompt: [
        { role: 'system', content: 'Standing rules' },
        { role: 'user', content: [{ type: 'text', text: 'x'.repeat(8000) }] },
      ],
    },
    {
      prompt: [{ role: 'system', content: 'Standing rules' }],
      tools: [{ type: 'function', name: 'probe', description: 'x'.repeat(8000), inputSchema: { type: 'object' } }],
    },
  ]
  let rejected = 0
  for (const params of cases) {
    try {
      await middleware.transformParams!({ type: 'stream', params, model: {} as never })
    } catch (error) {
      if ((error as Error).message.includes('exceed the context budget')) rejected++
    }
  }
  assert({
    given: 'a mission or tool definitions that cannot fit even with no tool results',
    should: 'reject locally without dropping instructions',
    actual: rejected,
    expected: 2,
  })
})

function step(parts: unknown[], unified: 'tool-calls' | 'stop') {
  return {
    // The provider stream is intentionally synthetic; the real SDK runs the loop.
    stream: simulateReadableStream<any>({
      chunks: [
        { type: 'stream-start', warnings: [] },
        ...parts,
        {
          type: 'finish',
          finishReason: { unified, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        },
      ],
    }),
  }
}

test('research bounds every accumulated SDK request while preserving the mission and tool exchanges', async () => {
  const model = new MockLanguageModelV3({
    doStream: [
      step(
        [{ type: 'tool-call', toolCallId: 'c1', toolName: 'notebook_read', input: '{"path":"first.md"}' }],
        'tool-calls',
      ),
      step(
        [{ type: 'tool-call', toolCallId: 'c2', toolName: 'notebook_read', input: '{"path":"second.md"}' }],
        'tool-calls',
      ),
      step(
        [
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: 'Found the demo decision.' },
          { type: 'text-end', id: 't' },
        ],
        'stop',
      ),
    ],
  })
  const engine = new ChatEngine({
    model: { model: wrapLanguageModel({ model, middleware: researchBudgetMiddleware(4000, 3500) }) },
    approvalHandler: async () => ({ approved: false, reason: 'Read-only research' }),
  })
  engine.appendUserMessage('Find the Atlas demo decision.')
  const result = await engine.runTurn({
    instructions: ['Standing rule: distinguish facts from inferences.'],
    tools: {
      notebook_read: {
        inputSchema: jsonSchema<{ path: string }>({
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        }),
        execute: async ({ path }: { path: string }) => ({
          path,
          markdown: path === 'first.md' ? 'First evidence. '.repeat(200_000) : 'Recent evidence. '.repeat(750),
        }),
      },
    },
    toolApproval: {},
  })
  const calls = model.doStreamCalls
  const final = JSON.stringify(calls.at(-1)?.prompt)
  assert({
    given: 'one huge result followed by another result in a real SDK tool loop',
    should: 'bound every request, keep the newest evidence, preserve call/result pairs and disclose shortening',
    actual: {
      reply: result.text,
      calls: calls.length,
      bounded: calls.every((call) => researchInputTokens(call as LanguageModelV4CallOptions) <= 4000),
      reading: calls.every((call) => researchEvidenceTokens(call as LanguageModelV4CallOptions) <= 3500),
      instructions: final.includes('Standing rule: distinguish facts from inferences.'),
      mission: final.includes('Find the Atlas demo decision.'),
      recent: final.includes('Recent evidence. '.repeat(750)),
      shortened: final.includes('Research result shortened'),
      ids: calls
        .at(-1)
        ?.prompt.filter((message) => message.role === 'tool')
        .flatMap((message) =>
          message.content.filter((part) => part.type === 'tool-result').map((part) => part.toolCallId),
        ),
      retained: JSON.stringify(engine.snapshotMessages()).includes('First evidence. '.repeat(200_000)),
    },
    expected: {
      reply: 'Found the demo decision.',
      calls: 3,
      bounded: true,
      reading: true,
      instructions: true,
      mission: true,
      recent: true,
      shortened: true,
      ids: ['c1', 'c2'],
      retained: true,
    },
  })
})
