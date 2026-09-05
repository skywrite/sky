/**
 * The line a person reads when a turn's model call fails.
 *
 * The SDK's own message is the provider's reason when there is one, and
 * that stands. A reply with no body at all — an edge in front of the API
 * answering 400 or 503 and saying nothing — leaves the SDK with only the
 * status text ("Bad Request"), which tells nobody anything. That case names
 * the host and the status and says the one useful thing: send it again.
 * A retry the SDK gave up on is judged by the error it gave up on.
 */

import { APICallError, RetryError } from 'ai'

export function turnErrorMessage(err: unknown): string {
  const cause = RetryError.isInstance(err) ? err.lastError : err
  if (APICallError.isInstance(cause) && cause.statusCode !== undefined && !cause.responseBody?.trim()) {
    return `${hostOf(cause.url)} answered ${cause.statusCode} with an empty body. Try sending it again.`
  }
  return cause instanceof Error ? cause.message : String(cause)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'the model API'
  }
}
