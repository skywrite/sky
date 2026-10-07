/**
 * Pages of a notebook document's text for a model — the service side of
 * `#shared/models/AI/DocumentPages`. The service is the only process that
 * opens a notebook file to feed a model: it strips the HTML comments, pages
 * the result, and stamps it, so every client sees one text and one set of
 * offsets.
 */

import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import {
  cleanDocumentText,
  type DocumentPageRequest,
  type DocumentPageResult,
  pageOf,
} from '#shared/models/AI/DocumentPages/mod.ts'

/** Answer every request in order. A path outside the notebook or a missing file is an error for that request only. */
export async function readDocumentPages(
  baseDir: string,
  requests: DocumentPageRequest[],
): Promise<DocumentPageResult[]> {
  const root = path.resolve(baseDir)
  const results: DocumentPageResult[] = []
  for (const request of requests) {
    const abs = path.resolve(root, request.path)
    if (!(abs.startsWith(root + path.sep) || abs === root)) {
      results.push({ path: request.path, error: 'Path is outside the notebook.' })
      continue
    }
    const rel = path.relative(root, abs)
    let raw: string
    try {
      raw = await readTextFile(abs)
    } catch {
      results.push({ path: rel, error: `No document at ${rel}.` })
      continue
    }
    results.push(pageOf(rel, cleanDocumentText(raw), request))
  }
  return results
}

/** The request body of POST /context/document, validated. */
export function parseDocumentPageRequests(body: unknown): DocumentPageRequest[] | null {
  const requests = (body as { requests?: unknown })?.requests
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 200) return null
  const parsed: DocumentPageRequest[] = []
  for (const r of requests) {
    if (!r || typeof r !== 'object' || typeof (r as { path?: unknown }).path !== 'string') return null
    const { path: p, offset, length, find } = r as Record<string, unknown>
    parsed.push({
      path: p as string,
      ...(typeof offset === 'number' ? { offset } : {}),
      ...(typeof length === 'number' ? { length } : {}),
      ...(typeof find === 'string' && find.length > 0 ? { find } : {}),
    })
  }
  return parsed
}
