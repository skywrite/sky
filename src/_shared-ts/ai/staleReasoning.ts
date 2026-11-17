import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { APICallError, type JSONValue, type LanguageModelMiddleware } from 'ai'

/**
 * Reasoning the API can no longer match, set aside so the turn is answered.
 *
 * The Claude models that keep their reasoning tie each reply's reasoning to everything sent
 * before it: the system prompt, the tool list and the earlier messages. When that reasoning
 * comes back after any of those changed, the API answers 400, and a retry sends the same thing
 * again. Chat still changes what it already sent (a thread reopened after a service restart
 * renders its prompt again), so a refused turn stayed refused.
 *
 * Who is refused differs by model and by account. Fable 5.2 and Mythos 5.2 refuse on every
 * account, so `resolveProfile` names the behavior up front for them. Opus 5.5, Sonnet 5.5,
 * Haiku 5.5 and Fable 5.1 refuse only on accounts created on or after 2026-08-31. Naming the
 * behavior up front there would opt an older account into the check and drop reasoning that
 * reaches the model today. So for every other Claude model the setting is added only once the
 * API has refused. See docs/2026-11-09-fable-5-2-refuses-a-reopened-chat.md.
 */

/**
 * Ask the API to set aside reasoning it can no longer match and answer anyway. A profile that
 * chose its own behavior keeps it, and thinking that is not adaptive is left as written: the
 * API takes the setting with adaptive thinking only. An untouched value comes back as given.
 */
export function settingStaleReasoningAside(thinking: JSONValue | undefined): JSONValue {
  if (thinking === undefined) return { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'drop_block' } }
  if (typeof thinking !== 'object' || thinking === null || Array.isArray(thinking)) return thinking
  const given = thinking as Readonly<Record<string, JSONValue | undefined>>
  if (given['type'] !== 'adaptive' || given['blockBinding'] !== undefined) return thinking
  return { ...given, blockBinding: { prefixMismatchBehavior: 'drop_block' } }
}

/**
 * The API's refusal of reasoning whose earlier request changed. A damaged signature opens with
 * the same words but never says the block belongs to another conversation, and the setting
 * does not help there, so only the full sentence counts.
 */
export function refusedChangedHistory(error: unknown): boolean {
  if (!APICallError.isInstance(error) || error.statusCode !== 400) return false
  return /bound to a different conversation/i.test(`${error.message}\n${error.responseBody ?? ''}`)
}

/** The same request with the setting added, or null when this request cannot take it. */
function settingAside(params: LanguageModelV4CallOptions): LanguageModelV4CallOptions | null {
  const anthropic = params.providerOptions?.['anthropic'] ?? {}
  const thinking = anthropic['thinking'] as JSONValue | undefined
  const aside = settingStaleReasoningAside(thinking)
  if (aside === thinking) return null
  return { ...params, providerOptions: { ...params.providerOptions, anthropic: { ...anthropic, thinking: aside } } }
}

/**
 * Answer a turn the API refused for changed history: send it once more with the setting.
 *
 * The refusal is decided before any output, so nothing is replayed and no tool runs twice. A
 * conversation refused once is refused on every later request, so the model that was refused
 * keeps sending the setting. That is safe on any account: only an account the API checks is
 * ever refused, and for it an unchanged history loses nothing.
 */
export function staleReasoningRetry(): LanguageModelMiddleware {
  let refused = false
  async function send<T>(
    params: LanguageModelV4CallOptions,
    call: (params: LanguageModelV4CallOptions) => PromiseLike<T>,
  ): Promise<T> {
    const upFront = refused ? settingAside(params) : null
    try {
      return await call(upFront ?? params)
    } catch (error) {
      if (upFront || !refusedChangedHistory(error)) throw error
      const again = settingAside(params)
      if (!again) throw error
      params.abortSignal?.throwIfAborted()
      refused = true
      return await call(again)
    }
  }
  return {
    wrapGenerate: ({ params, model }) => send(params, (sent) => model.doGenerate(sent)),
    wrapStream: ({ params, model }) => send(params, (sent) => model.doStream(sent)),
  }
}
