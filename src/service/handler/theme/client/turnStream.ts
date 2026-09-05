/**
 * A turn's stream, from the page's side: frames off it as they complete,
 * silence on it as a lost connection, and the wait for the service after
 * one — on the terminal's own schedule for a restart, which unbinds the
 * port for up to about a minute.
 */

export interface Frame {
  event: string
  data: Record<string, unknown>
}

/** The stream said nothing for longer than the deadline — the connection is gone, however the socket looks. */
export class Silence extends Error {
  constructor(ms: number) {
    super(`nothing from the service for ${Math.round(ms / 1000)}s`)
    this.name = 'Silence'
  }
}

/**
 * Frames off a streaming response, as they complete. The service speaks at
 * least every ten seconds while a turn runs — a heartbeat when nothing else
 * — so silence past `silenceMs` is a connection that died with the socket
 * still open, and the stream ends with a `Silence`.
 */
export async function* frames(response: Response, silenceMs: number): AsyncGenerator<Frame> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const silence = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Silence(silenceMs)), silenceMs)
    })
    let chunk: Awaited<ReturnType<typeof reader.read>>
    try {
      chunk = await Promise.race([reader.read(), silence])
    } catch (err) {
      void reader.cancel().catch(() => {})
      throw err
    } finally {
      clearTimeout(timer)
    }
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    let end = buffer.indexOf('\n\n')
    while (end >= 0) {
      const raw = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let event = 'message'
      let data = ''
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      yield { event, data: data ? (JSON.parse(data) as Record<string, unknown>) : {} }
      end = buffer.indexOf('\n\n')
    }
  }
}

/** The terminal's schedule for a service restart: about ninety seconds, front-loaded. */
export const RETURN_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000]

/** What the service says once it answers again. */
export type Return =
  /** An answer — the caller reads it; a 404 is `gone` instead, a 5xx is a service still starting */
  | { kind: 'answered'; response: Response }
  /** The service is back and has no such thread */
  | { kind: 'gone' }
  /** The service never answered */
  | { kind: 'away' }

/**
 * Wait for the service to answer again. Each delay on the schedule is
 * slept, then `read` is tried: an answer or word that there is no such
 * thread ends the wait; a refused connection or a server error is a service
 * still starting, and the wait moves to the next delay.
 */
export async function awaitReturn(
  read: () => Promise<Response>,
  delays: readonly number[] = RETURN_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Return> {
  for (const delay of delays) {
    await sleep(delay)
    let response: Response
    try {
      response = await read()
    } catch {
      continue
    }
    if (response.status === 404) return { kind: 'gone' }
    if (response.status >= 500) continue
    return { kind: 'answered', response }
  }
  return { kind: 'away' }
}
