import type { LanguageModelMiddleware } from 'ai'
import wellFormed from '#shared/strings/wellFormed.ts'

/**
 * Repairs unpaired surrogates in an outbound prompt, for every model call that
 * goes through the registry.
 *
 * The call sites that truncate prompt text already cut on whole characters
 * (see `truncate`), but they are not the only way a broken half reaches a
 * request: any future length cap, a partially-decoded fetch, or a notebook
 * file written by something that split an emoji can do it too. One orphan half
 * anywhere in the payload makes the API reject the whole request body, and the
 * failure surfaces far from its cause — as a dead context query or a lost
 * summary, not as "bad character in message 3". Cheaper to guarantee the
 * invariant at the boundary than to rediscover it per call site.
 *
 * Only `params.prompt` is walked: it holds every runtime-derived string
 * (messages, tool inputs, tool results), while the rest of the call options
 * are code-authored constants. Prompts are almost always clean, in which case
 * `wellFormed` hands back the same reference and the params object is passed
 * through untouched.
 */
export const wellFormedPromptMiddleware: LanguageModelMiddleware = {
  async transformParams({ params }) {
    const prompt = wellFormed(params.prompt)
    return prompt === params.prompt ? params : { ...params, prompt }
  },
}

export default wellFormedPromptMiddleware
