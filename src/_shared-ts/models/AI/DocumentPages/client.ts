/**
 * Pages of notebook documents from the running service (POST /context/document).
 * Readers that feed a model never open notebook files themselves: the
 * service's text is the only text, so every reader sees the same characters
 * at the same offsets. When the service is unreachable the pages are errors,
 * never a disk read — a second reader is how the hygiene drifted before.
 */

import { logAIError } from '#shared/ai/errorLog.ts'
import { PORT_SERVER } from '#shared/config.ts'
import { fetchWithConnectRetry } from '#shared/models/Chat/ChatContext/fetchContext.ts'
import type { DocumentPageRequest, DocumentPageResult } from './mod.ts'

/** Requests per HTTP call — bounds one response to a few MB of page text. */
const BATCH = 40

export type DocumentPageFetcher = (requests: DocumentPageRequest[]) => Promise<DocumentPageResult[]>

/** Fetch pages for every request, in order; a transport failure yields an error per request. */
export async function fetchDocumentPages(
  requests: DocumentPageRequest[],
  source = 'ai:research',
): Promise<DocumentPageResult[]> {
  const results: DocumentPageResult[] = []
  for (let i = 0; i < requests.length; i += BATCH) {
    results.push(...(await fetchBatch(requests.slice(i, i + BATCH), source)))
  }
  return results
}

async function fetchBatch(requests: DocumentPageRequest[], source: string): Promise<DocumentPageResult[]> {
  const url = `http://localhost:${PORT_SERVER}/context/document`
  const failAll = async (message: string): Promise<DocumentPageResult[]> => {
    console.warn(`[${source}] ${message}`)
    await logAIError({ source, stage: 'context:document', message })
    return requests.map((r) => ({ path: r.path, error: message }))
  }
  let resp: Response
  try {
    resp = await fetchWithConnectRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    })
  } catch (err) {
    return failAll(`notebook service unreachable at ${url}: ${(err as Error).message}`)
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    return failAll(`document pages failed (${resp.status} ${resp.statusText}): ${body.slice(0, 200)}`)
  }
  let json: unknown
  try {
    json = await resp.json()
  } catch (err) {
    return failAll(`document pages response not valid JSON: ${(err as Error).message}`)
  }
  const pages = (json as { data?: { pages?: DocumentPageResult[] } })?.data?.pages
  if (!Array.isArray(pages) || pages.length !== requests.length) {
    return failAll('document pages response did not answer every request')
  }
  return pages
}
