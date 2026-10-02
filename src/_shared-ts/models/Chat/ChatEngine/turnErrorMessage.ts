/**
 * The line a person reads when a model call fails: in a chat turn, on a
 * page, or from the chat model passing on a tool's result.
 *
 * An answer from a model API leads with whose API failed and the status it
 * answered, so an outage at the provider never reads as a fault in Sky:
 * "Anthropic API error (529): Overloaded". The reason is the provider's
 * own, read from the body even when the SDK did not read it — an OpenAI-
 * compatible host like Cerebras writes `{"message": …}` at the top, where
 * the OpenAI provider looks for `{"error": {"message": …}}` — and the
 * SDK's message (at worst the status text) stands when the body gives
 * none. A reply with no body at all — an edge in front of the API
 * answering 400 or 503 and saying nothing — says the one useful thing: try
 * again. A retry the SDK gave up on is judged by the error it gave up on.
 * Anything that is not an API answer, like a call that never reached the
 * API, keeps its own message.
 */

import { APICallError, RetryError } from 'ai'

export function apiErrorMessage(err: unknown): string {
  const cause = RetryError.isInstance(err) ? err.lastError : err
  if (!APICallError.isInstance(cause) || cause.statusCode === undefined)
    return cause instanceof Error ? cause.message : String(cause)
  const head = `${providerOf(cause.url)} API error (${cause.statusCode})`
  const body = cause.responseBody?.trim()
  if (!body) return `${head}: no reason given. Try again.`
  const reason = reasonIn(body) ?? cause.message.trim()
  return reason ? `${head}: ${reason}` : head
}

/**
 * The reason a host wrote into its error body, wherever it put it: OpenAI
 * and Anthropic nest it as `error.message`, Cerebras writes `message` at
 * the top. A body that is not JSON, or says nothing, has no reason.
 */
function reasonIn(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: { message?: unknown } | string }
    const nested = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message
    const reason = nested ?? parsed.message
    return typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : undefined
  } catch {
    return undefined
  }
}

/** The model APIs Sky's providers call, by the name a person knows them by. Any other host is named as itself. */
const PROVIDER_NAMES: Record<string, string> = {
  'api.anthropic.com': 'Anthropic',
  'api.openai.com': 'OpenAI',
  'api.cerebras.ai': 'Cerebras',
}

function providerOf(url: string): string {
  try {
    const { host } = new URL(url)
    return PROVIDER_NAMES[host] ?? host
  } catch {
    return 'Model'
  }
}
