import type { SystemModelMessage } from 'ai'

/**
 * Prompt-cache plumbing for AI SDK calls.
 *
 * Anthropic caches an exact byte prefix up to an explicit `cacheControl`
 * breakpoint (write 1.25x once, read 0.1x, 5-minute rolling TTL), so prompts
 * must keep their stable content first and volatile content (dates, times,
 * per-call hints) last. The breakpoint is namespaced provider metadata:
 * OpenAI/ollama/lm-studio models ignore it, and OpenAI prefix-caches
 * automatically given the same stable-first layout — so call sites stay
 * provider-agnostic and roles can be repointed freely.
 */

/**
 * Marker splitting a rendered prompt file into a cacheable stable prefix and
 * a volatile tail. Everything above the marker must be byte-identical across
 * calls (instructions, schema, entity lists); everything below may vary.
 */
export const PROMPT_CACHE_BOUNDARY = '<!-- prompt-cache-boundary -->'

const CACHE_BREAKPOINT = { anthropic: { cacheControl: { type: 'ephemeral' as const } } }

/**
 * Build `instructions:` messages with prompt-cache breakpoints on the stable
 * content.
 *
 * A string input is split at PROMPT_CACHE_BOUNDARY: the stable prefix gets a
 * breakpoint, the tail (if any) follows uncached. An array input treats each
 * non-empty segment as an independently cacheable unit — segment boundaries
 * should track how content changes over time (e.g. per-session base prompt,
 * per-turn context block), so a change re-writes only the segments after it.
 */
export function cachedInstructions(input: string | string[]): SystemModelMessage[] {
  if (typeof input === 'string') {
    const [stable, ...rest] = input.split(PROMPT_CACHE_BOUNDARY)
    const volatile = rest.join(PROMPT_CACHE_BOUNDARY).trim()
    const messages: SystemModelMessage[] = [
      { role: 'system', content: stable.trim(), providerOptions: CACHE_BREAKPOINT },
    ]
    if (volatile) messages.push({ role: 'system', content: volatile })
    return messages
  }

  return input
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
    .map((segment) => ({ role: 'system' as const, content: segment, providerOptions: CACHE_BREAKPOINT }))
}

/** Structural constraint: any message shape that can carry provider options. */
interface CacheTailMessage {
  role: string
  content: unknown
  providerOptions?: Record<string, Record<string, unknown> | undefined>
}

/**
 * Return a copy of a conversation with a cache breakpoint on its final
 * message (and on no other), so each turn reads the whole replayed history
 * from cache and writes only the new tail. Call this per request — it moves
 * the breakpoint as the conversation grows; the input array is not mutated.
 */
export function withCacheTail<T extends CacheTailMessage>(messages: T[]): T[] {
  return messages.map((message, i) => {
    const isLast = i === messages.length - 1
    const anthropicOptions = message.providerOptions?.['anthropic']
    const hasBreakpoint = anthropicOptions !== undefined && 'cacheControl' in anthropicOptions

    if (isLast) {
      return {
        ...message,
        providerOptions: {
          ...message.providerOptions,
          anthropic: { ...anthropicOptions, ...CACHE_BREAKPOINT.anthropic },
        },
      } as T
    }

    if (!hasBreakpoint) return message

    // Stale breakpoint from an earlier turn's tail — drop it so the moving
    // tail marker never accumulates toward Anthropic's 4-breakpoint limit.
    const { cacheControl: _dropped, ...restAnthropic } = anthropicOptions
    const providerOptions = { ...message.providerOptions }
    if (Object.keys(restAnthropic).length > 0) {
      providerOptions['anthropic'] = restAnthropic
    } else {
      delete providerOptions['anthropic']
    }
    return (
      Object.keys(providerOptions).length > 0
        ? { ...message, providerOptions }
        : { ...message, providerOptions: undefined }
    ) as T
  })
}
