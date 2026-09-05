import { registerTelemetry, type Telemetry } from 'ai'
import type { TokenUsage } from '#universal/ai/tokenUsage.ts'
import { currentTimingSpan, thrownOutcome, TimingSpan, timingOutcome } from './mod.ts'

function usageOf(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const usage = value as {
    inputTokens?: { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number }
    outputTokens?: { total?: number }
  }
  const cacheRead = usage.inputTokens?.cacheRead ?? 0
  const cacheWrite = usage.inputTokens?.cacheWrite ?? 0
  return {
    input: usage.inputTokens?.noCache ?? Math.max(0, (usage.inputTokens?.total ?? 0) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: usage.outputTokens?.total ?? 0,
  }
}

/** Observe the provider stream through its completion, not just receipt of HTTP headers. */
function timedStream(stream: ReadableStream<unknown>, span: TimingSpan): ReadableStream<unknown> {
  const reader = stream.getReader()
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          span.finish('incomplete')
          controller.close()
          reader.releaseLock()
          return
        }
        if (value && typeof value === 'object') {
          const part = value as { type?: string; usage?: unknown; finishReason?: { unified?: string } }
          if (part.type === 'text-delta' || part.type === 'reasoning-delta' || part.type === 'tool-input-delta')
            span.firstOutput()
          if (part.type === 'error') span.finish('error')
          if (part.type === 'finish')
            span.finish(part.finishReason?.unified === 'error' ? 'error' : 'success', usageOf(part.usage))
        }
        controller.enqueue(value)
      } catch (error) {
        span.finish(thrownOutcome(error))
        controller.error(error)
        reader.releaseLock()
      }
    },
    async cancel(reason) {
      span.finish('aborted')
      try {
        await reader.cancel(reason)
      } finally {
        reader.releaseLock()
      }
    },
  })
}

/** Global SDK hooks cover every executable tool, including a tool's nested agent calls. */
export function createTimingTelemetry(): Telemetry {
  const tools = new WeakMap<object, TimingSpan>()
  const steps = new WeakMap<TimingSpan, Map<string, { step: number; attempt: number }>>()
  return {
    onStepStart(event) {
      const parent = currentTimingSpan()
      if (!parent) return
      let calls = steps.get(parent)
      if (!calls) {
        calls = new Map()
        steps.set(parent, calls)
      }
      calls.set(event.callId, { step: event.stepNumber, attempt: 0 })
    },
    onEnd(event) {
      const parent = currentTimingSpan()
      if (parent) steps.get(parent)?.delete(event.callId)
    },
    onAbort(event) {
      const parent = currentTimingSpan()
      if (parent) steps.get(parent)?.delete(event.callId)
    },
    async executeLanguageModelCall({ execute, callId, provider, modelId }) {
      const parent = currentTimingSpan()
      const state = parent ? steps.get(parent)?.get(callId) : undefined
      const span = new TimingSpan({
        kind: 'model',
        name: modelId ?? 'model',
        provider,
        model: modelId,
        callId,
        step: state?.step,
        attempt: state ? ++state.attempt : 1,
      })
      try {
        const result = await span.run(execute)
        if (result && typeof result === 'object') {
          const response = result as { stream?: ReadableStream<unknown>; usage?: unknown }
          if (response.stream instanceof ReadableStream)
            return { ...result, stream: timedStream(response.stream, span) }
          span.finish('success', usageOf(response.usage))
        } else span.finish()
        return result
      } catch (error) {
        span.finish(thrownOutcome(error))
        throw error
      }
    },
    async executeTool({ execute, toolCall }) {
      const span = new TimingSpan({ kind: 'tool', name: toolCall?.toolName ?? 'tool' })
      if (toolCall) tools.set(toolCall, span)
      try {
        const result = await span.run(execute)
        if (!toolCall) span.finish()
        return result
      } catch (error) {
        span.finish(thrownOutcome(error))
        throw error
      }
    },
    onToolExecutionEnd({ toolCall, toolOutput }) {
      const span = tools.get(toolCall)
      if (!span) return
      span.finish(toolOutput.type === 'tool-error' ? thrownOutcome(toolOutput.error) : timingOutcome(toolOutput.output))
      tools.delete(toolCall)
    },
  }
}

let installed = false
export function installTimingTelemetry(): void {
  if (installed) return
  installed = true
  registerTelemetry(createTimingTelemetry())
}
