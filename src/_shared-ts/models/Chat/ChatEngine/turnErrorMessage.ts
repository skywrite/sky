/**
 * The line a person reads when a turn's model call fails.
 *
 * The SDK's own message is the provider's reason when there is one, and
 * that stands. Two answers leave the SDK with only the status text ("Bad
 * Request"), which tells nobody anything. A reply with no body at all — an
 * edge in front of the API answering 400 or 503 and saying nothing — names
 * the host and the status and says the one useful thing: send it again. A
 * reply whose body carries a reason the SDK did not read — an OpenAI-
 * compatible host like Cerebras writes `{"message": …}` at the top, where
 * the OpenAI provider looks for `{"error": {"message": …}}` — names the
 * host and the status and quotes the reason. A retry the SDK gave up on is
 * judged by the error it gave up on.
 */

import { APICallError, RetryError } from 'ai'

export function turnErrorMessage(err: unknown): string {
  const cause = RetryError.isInstance(err) ? err.lastError : err
  if (APICallError.isInstance(cause) && cause.statusCode !== undefined) {
    const body = cause.responseBody?.trim()
    if (!body) return `${hostOf(cause.url)} answered ${cause.statusCode} with an empty body. Try sending it again.`
    const reason = reasonIn(body)
    if (reason !== undefined && !cause.message.includes(reason)) {
      return `${hostOf(cause.url)} answered ${cause.statusCode}: ${reason}`
    }
  }
  return cause instanceof Error ? cause.message : String(cause)
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

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'the model API'
  }
}
