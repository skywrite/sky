import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

/** Exercise the real browser task loop without a model provider or personal website data. */
export function scriptedBrowserModel(calls: { name: string; input?: Record<string, unknown> }[]) {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  }
  return {
    model: new MockLanguageModelV3({
      doStream: [
        ...calls.map((call, index) => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start' as const, warnings: [] },
              {
                type: 'tool-call' as const,
                toolCallId: `step-${index}`,
                toolName: call.name,
                input: JSON.stringify(call.input ?? {}),
              },
              { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage },
            ],
          }),
        })),
        {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'done' },
              { type: 'text-delta', id: 'done', delta: 'Finished the requested browser task.' },
              { type: 'text-end', id: 'done' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
            ],
          }),
        },
      ],
    }),
  }
}
