import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { LanguageModelMiddleware } from 'ai'
import { DIR_STATE } from '#config'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import { observeRatio, seedRatio, type TokenRatio } from '#universal/ai/tokenRatio.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

/**
 * The learned real-per-estimated token ratio, per model, kept across
 * restarts in the state folder. Every resolved model carries the meter
 * below, so each call it makes is an observation: the request as the SDK
 * serialized it, estimated at four characters a token, against the input
 * tokens the provider counted. The chat's window fit and its slider reach
 * read `ratioFor`; see universal/ai/tokenRatio.ts for the seeds and the math.
 */
export const TOKEN_RATIOS_PATH = path.join(DIR_STATE, 'ai', 'token-ratios.json')

interface Store {
  path: string
  ratios: Map<string, TokenRatio>
  loaded: Promise<void>
  flush: ReturnType<typeof setTimeout> | null
}

function openStore(file: string): Store {
  const store: Store = { path: file, ratios: new Map(), loaded: Promise.resolve(), flush: null }
  store.loaded = readRatios(file).then((parsed) => {
    for (const [model, record] of Object.entries(parsed)) store.ratios.set(model, record)
  })
  return store
}

const live = openStore(TOKEN_RATIOS_PATH)

/** Real tokens per estimated token for a model: learned when observed, else the family seed. */
export function ratioFor(modelId: string, store: Store = live): number {
  return store.ratios.get(modelId)?.ratio ?? seedRatio(modelId)
}

/** The learned record, for display and tests; undefined when only the seed stands. */
export function learnedRatio(modelId: string, store: Store = live): TokenRatio | undefined {
  return store.ratios.get(modelId)
}

/** Fold one observation in and schedule a write. Never throws — a count must not break the call it observes. */
export function observeTokens(modelId: string, estimated: number, real: number, store: Store = live): void {
  const next = observeRatio(store.ratios.get(modelId), estimated, real, ZonedDateTime.now().toString())
  if (!next || next === store.ratios.get(modelId)) return
  store.ratios.set(modelId, next)
  if (store.flush) clearTimeout(store.flush)
  store.flush = setTimeout(() => {
    store.flush = null
    void persist(store)
  }, 2000)
  store.flush.unref?.()
}

/**
 * Write the store, merged with what another process wrote meanwhile: the
 * service and every command process learn independently and share the
 * file, so each write keeps, per model, the record with more samples.
 */
async function persist(store: Store): Promise<void> {
  try {
    await mkdir(path.dirname(store.path), { recursive: true })
    const onDisk = await readRatios(store.path)
    for (const [model, record] of Object.entries(onDisk)) {
      const mine = store.ratios.get(model)
      if (!mine || record.samples > mine.samples) store.ratios.set(model, record)
    }
    const sorted = Object.fromEntries([...store.ratios.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    await writeFile(store.path, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
  } catch {
    // The next observation writes again.
  }
}

async function readRatios(file: string): Promise<Record<string, TokenRatio>> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, TokenRatio>
    return Object.fromEntries(
      Object.entries(parsed).filter(([, r]) => typeof r?.ratio === 'number' && typeof r.samples === 'number'),
    )
  } catch {
    return {}
  }
}

/** Test seam: a store on its own file, loaded before use. */
export async function openTokenRatioStore(file: string): Promise<Store> {
  const store = openStore(file)
  await store.loaded
  return store
}

/** Test seam: wait for pending writes of a store. */
export async function flushTokenRatios(store: Store = live): Promise<void> {
  if (store.flush) {
    clearTimeout(store.flush)
    store.flush = null
    await persist(store)
  }
}

interface ProviderUsage {
  inputTokens: { noCache: number | undefined; cacheRead: number | undefined; cacheWrite: number | undefined }
}

function realInput(usage: ProviderUsage): number {
  return (usage.inputTokens.noCache ?? 0) + (usage.inputTokens.cacheRead ?? 0) + (usage.inputTokens.cacheWrite ?? 0)
}

/**
 * The request's estimated size, or null when it is not a sample: a request
 * carrying tool results measures the tokenizer on JSON, which counts leaner
 * than the prose and documents the budget estimates, and would pull the
 * ratio under what a context-heavy first request really costs.
 */
export function sampleEstimate(params: { prompt: ReadonlyArray<{ role: string }>; tools?: unknown }): number | null {
  if (params.prompt.some((message) => message.role === 'tool')) return null
  return estimateTokens(JSON.stringify({ prompt: params.prompt, tools: params.tools }))
}

/**
 * Middleware that observes the calls a model makes: the serialized request
 * (prompt and tools, the same text the budget estimates) against the input
 * the provider counted, for requests without tool results (sampleEstimate).
 * A generation observes once it returns; a stream as its finish part
 * passes, parts flowing through untouched.
 */
export function tokenRatioMeter(profile: { model: string }, store: Store = live): LanguageModelMiddleware {
  return {
    wrapGenerate: async ({ doGenerate, params }) => {
      const estimated = sampleEstimate(params)
      const result = await doGenerate()
      if (estimated !== null) observeTokens(profile.model, estimated, realInput(result.usage), store)
      return result
    },
    wrapStream: async ({ doStream, params }) => {
      const estimated = sampleEstimate(params)
      const { stream, ...rest } = await doStream()
      type Part = typeof stream extends ReadableStream<infer P> ? P : never
      const metered = stream.pipeThrough(
        new TransformStream<Part, Part>({
          transform(part, controller) {
            if (part.type === 'finish' && estimated !== null)
              observeTokens(profile.model, estimated, realInput(part.usage), store)
            controller.enqueue(part)
          },
        }),
      )
      return { ...rest, stream: metered }
    },
  }
}
