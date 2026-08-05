/**
 * Document fetching against the running notebook service, with the connect
 * retry policy sized to a service restart. Used by ChatContext for the
 * baseline gather; `fetchWithConnectRetry` is also exported for hosts that
 * make their own service calls (e.g. the CLI's older-chats picker), so the
 * whole process shares one retries-exhausted state.
 */

import { PORT_SERVER } from '#shared/config.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { logAIError } from '#shared/ai/errorLog.ts'

// A service restart unbinds :9999 for up to ~70s — launchd takes 20-45s to
// respawn the process, then the notebook rescan takes ~24s before the port
// binds — and a context fetch in that window used to fail hard: the turn
// then ran without queried context. Spread ~90s of retries across the
// window (mirrors markdown:sel's GraphQL fetch); once one fetch exhausts
// them the service is down rather than restarting, so later fetches in the
// same session fail fast instead of stacking retry waits. Any success
// re-arms.
const CONNECT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000]
let connectRetriesExhausted = false

export async function fetchWithConnectRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, init)
      connectRetriesExhausted = false
      return response
    } catch (err) {
      if (connectRetriesExhausted || attempt >= CONNECT_RETRY_DELAYS_MS.length) {
        connectRetriesExhausted = true
        throw err
      }
      const delayMs = CONNECT_RETRY_DELAYS_MS[attempt]
      console.warn(`[ai:chat] notebook service unreachable — retrying in ${delayMs / 1000}s...`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

/**
 * Fetch documents from the running notebook service via POST /context.
 * The server executes the GraphQL query, resolves relationships to the given depth,
 * and returns {path, type, markdown} triples.
 */
export async function fetchContextFromServer(
  query: string,
  depth = 1,
): Promise<Array<{ doc: Document; path: string }>> {
  const url = `http://localhost:${PORT_SERVER}/context`
  let resp: Response
  try {
    resp = await fetchWithConnectRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, depth }),
    })
  } catch (err) {
    const message = `notebook service unreachable at ${url}: ${(err as Error).message}`
    console.warn(`[ai:chat] ${message}`)
    await logAIError({ source: 'ai:chat', stage: 'context:server', message, query })
    return []
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    const message = `context fetch failed (${resp.status} ${resp.statusText}): ${body.slice(0, 200)}`
    console.warn(`[ai:chat] ${message}`)
    await logAIError({ source: 'ai:chat', stage: 'context:server', message, query })
    return []
  }

  let json: unknown
  try {
    json = await resp.json()
  } catch (err) {
    const message = `context response not valid JSON: ${(err as Error).message}`
    console.warn(`[ai:chat] ${message}`)
    await logAIError({ source: 'ai:chat', stage: 'context:server', message, query })
    return []
  }
  const documents =
    (json as { data?: { documents?: Array<{ path?: string; markdown?: string }> } })?.data?.documents ?? []
  const docs: Array<{ doc: Document; path: string }> = []
  for (const d of documents) {
    if (d.path && d.markdown) {
      try {
        const doc = Document.fromMarkdown(d.markdown)
          .stripHtmlComments()
          .filterSections((h) => !h.text.toLowerCase().includes('transcript'))
        docs.push({ doc, path: d.path })
      } catch (err) {
        console.warn(`[ai:chat] failed to parse context doc ${d.path}: ${(err as Error).message}`)
      }
    }
  }
  return docs
}
