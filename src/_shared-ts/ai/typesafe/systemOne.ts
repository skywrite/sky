import type { Questions, RequestOptions, SystemOneRequest, SystemOneResult, TypeSafeClient } from '@typesafe-ai/sdk'
import { type AIUsageRecord, currentUsageSource, logAIUsage } from '#shared/ai/usageLog.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

/**
 * Ask Jev the questions, and record the request the way every model call
 * is recorded: one line in the usage log under provider `typesafe`, with
 * the model TypeSafe answered with and the input tokens — Jev bills input
 * only — so `sky ai:usage` shows it beside the language models. `sink` is
 * the record's destination, the usage log unless a test listens instead.
 */
export async function askTypeSafe<const Q extends Questions>(
  client: TypeSafeClient,
  request: SystemOneRequest<Q>,
  options: RequestOptions & { sink?: (record: AIUsageRecord) => void | Promise<void> } = {},
): Promise<SystemOneResult<Q>> {
  const { sink = logAIUsage, ...requestOptions } = options
  const result = await client.systemOne(request, requestOptions)
  void sink({
    ts: ZonedDateTime.now().toString(),
    source: currentUsageSource(),
    provider: 'typesafe',
    model: result.model,
    input: result.usage.input_tokens,
    cacheRead: 0,
    cacheWrite: 0,
    output: result.usage.output_tokens,
  })
  return result
}
