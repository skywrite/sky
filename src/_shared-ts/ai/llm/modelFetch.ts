/** A quiet model request can need the full 20-minute transcript deadline. */
const MODEL_IDLE_TIMEOUT_MS = 20 * 60_000

/** Give model calls an explicit Bun socket idle backstop while forwarding the caller's deadline and cancellation. */
export function createModelFetch(options: { fetch?: typeof fetch; idleTimeoutMs?: number | false } = {}): typeof fetch {
  const { fetch: base, idleTimeoutMs = MODEL_IDLE_TIMEOUT_MS } = options
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = { ...init, timeout: idleTimeoutMs }
    return (base ?? fetch)(input, request)
  }) as typeof fetch
}
