import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFile, mkdir } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { LanguageModelMiddleware } from 'ai'
import { DIR_USER_DATA } from '#config'
import type { TokenUsage } from '#universal/ai/tokenUsage.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

/**
 * Persistent JSONL record of every model call's token counts, beside the
 * error log. Nothing in the pipeline read `usage` before this: a mission's
 * cost, a chat's cache share, a summary command's spend were all invisible
 * until the invoice. Every call appends one line here — model, source, the
 * four counts — through a middleware on every resolved model, so no call
 * site has to remember. `sky ai:usage` rolls the day up.
 *
 * Inspect with: tail -20 <userDataDir>/logs/ai-usage.jsonl | jq
 */
export const AI_USAGE_LOG_PATH = path.join(DIR_USER_DATA, 'logs', 'ai-usage.jsonl')

/** Home-relative form of the log path for terminal display. */
export const AI_USAGE_LOG_DISPLAY = AI_USAGE_LOG_PATH.startsWith(os.homedir())
  ? `~${AI_USAGE_LOG_PATH.slice(os.homedir().length)}`
  : AI_USAGE_LOG_PATH

export interface AIUsageRecord extends TokenUsage {
  /** Notebook-zone timestamp, `YYYY-MM-DD HH:MM Zone` */
  ts: string
  /** The command running when the call was made (`ai:chat`, `google:agent`), or the process when none was */
  source: string
  provider: string
  /** The model id as the provider knows it */
  model: string
}

// The command a model call belongs to, carried across awaits. The command
// service sets it for every command it runs, the CLI runner for the
// top-level one, and the chat routes for a turn — so a mission called as a
// chat tool records as the mission, and the chat's own calls as the chat.
const sourceStore = new AsyncLocalStorage<string>()

export function runWithUsageSource<T>(source: string, fn: () => T): T {
  return sourceStore.run(source, fn)
}

/** The command in whose name the current call is made, else the process kind. */
export function currentUsageSource(): string {
  return sourceStore.getStore() ?? (process.argv[1]?.endsWith('command-runner.ts') ? 'cli' : 'service')
}

/** Append one call's counts. Never throws — the record must not break the call it observes. */
export async function logAIUsage(record: AIUsageRecord): Promise<void> {
  try {
    await mkdir(path.dirname(AI_USAGE_LOG_PATH), { recursive: true })
    await appendFile(AI_USAGE_LOG_PATH, JSON.stringify(record) + '\n', 'utf8')
  } catch {
    // Swallow: a broken log file must never take down a model call
  }
}

/** The provider's usage object as the four billed counts; a count the provider leaves out is zero. */
interface ProviderUsage {
  inputTokens: { noCache: number | undefined; cacheRead: number | undefined; cacheWrite: number | undefined }
  outputTokens: { total: number | undefined }
}

function countsOf(usage: ProviderUsage): TokenUsage {
  return {
    input: usage.inputTokens.noCache ?? 0,
    cacheRead: usage.inputTokens.cacheRead ?? 0,
    cacheWrite: usage.inputTokens.cacheWrite ?? 0,
    output: usage.outputTokens.total ?? 0,
  }
}

/**
 * Middleware that records every call a model makes. A generation records
 * once it returns; a stream records as its finish part passes, and the
 * parts flow through untouched. `sink` is the record's destination, the
 * usage log unless a test listens instead.
 */
export function usageMeter(
  profile: { provider: string; model: string },
  sink: (record: AIUsageRecord) => void | Promise<void> = logAIUsage,
): LanguageModelMiddleware {
  const record = (usage: ProviderUsage) => {
    void sink({
      ts: ZonedDateTime.now().toString(),
      source: currentUsageSource(),
      provider: profile.provider,
      model: profile.model,
      ...countsOf(usage),
    })
  }
  return {
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      record(result.usage)
      return result
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()
      type Part = typeof stream extends ReadableStream<infer P> ? P : never
      const metered = stream.pipeThrough(
        new TransformStream<Part, Part>({
          transform(part, controller) {
            if (part.type === 'finish') record(part.usage)
            controller.enqueue(part)
          },
        }),
      )
      return { ...rest, stream: metered }
    },
  }
}
