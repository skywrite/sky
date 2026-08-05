import { validateBatchRequests } from './batchValidate.ts'
import type { GoogleClient } from './client.ts'

export const DOCS_API_URL = 'https://docs.googleapis.com/v1/documents'

/**
 * batchUpdate request kinds the agent may emit. A fixed allowlist keeps the
 * blast radius of model-authored requests known; extend deliberately.
 */
export const DOCS_ALLOWED_REQUESTS = new Set([
  'replaceAllText',
  'insertText',
  'deleteContentRange',
  'updateTextStyle',
  'updateParagraphStyle',
  'updateDocumentStyle',
  'insertTable',
  'insertTableRow',
  'deleteTableRow',
  'updateTableCellStyle',
  'createParagraphBullets',
  'deleteParagraphBullets',
  'insertPageBreak',
  'insertSectionBreak',
  'insertInlineImage',
  'createHeader',
  'createFooter',
])

const MAX_REQUESTS_PER_BATCH = 100

/** Returns a user/agent-readable problem description, or null when the batch is acceptable. */
export function validateDocsRequests(requests: unknown): string | null {
  return validateBatchRequests(requests, DOCS_ALLOWED_REQUESTS, MAX_REQUESTS_PER_BATCH)
}

/** Apply validated batchUpdate requests; returns the number of replies. */
export async function batchUpdateDoc(
  client: GoogleClient,
  fileId: string,
  requests: Array<Record<string, unknown>>,
): Promise<number> {
  const body = await client.postJson<{ replies?: unknown[] }>(
    `${DOCS_API_URL}/${encodeURIComponent(fileId)}:batchUpdate`,
    { requests },
  )
  return body.replies?.length ?? requests.length
}

// ── Outline (compact view of documents.get for the agent) ──────────────

export interface DocOutlineEntry {
  style: string
  text: string
  startIndex?: number
  endIndex?: number
  /** Link target for a clickable TOC (textStyle.link.headingId). */
  headingId?: string
}

export interface DocOutline {
  title?: string
  headings: DocOutlineEntry[]
  paragraphCount: number
  endIndex?: number
}

interface RawParagraphElement {
  textRun?: { content?: string }
}

interface RawStructuralElement {
  startIndex?: number
  endIndex?: number
  paragraph?: {
    paragraphStyle?: { namedStyleType?: string; headingId?: string }
    elements?: RawParagraphElement[]
  }
}

interface RawDocument {
  title?: string
  body?: { content?: RawStructuralElement[] }
}

/**
 * Compact a documents.get response into what the agent needs for range-based
 * styling: headings with their indexes, plus coarse document size. The full
 * JSON tree is far too large to hand to a model.
 */
export function summarizeDocument(doc: RawDocument): DocOutline {
  const headings: DocOutlineEntry[] = []
  let paragraphCount = 0
  let endIndex: number | undefined

  for (const element of doc.body?.content ?? []) {
    if (element.endIndex !== undefined) endIndex = element.endIndex
    const paragraph = element.paragraph
    if (!paragraph) continue
    paragraphCount++
    const style = paragraph.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT'
    if (style === 'TITLE' || style.startsWith('HEADING_')) {
      const text = (paragraph.elements ?? [])
        .map((e) => e.textRun?.content ?? '')
        .join('')
        .trim()
      headings.push({
        style,
        text,
        startIndex: element.startIndex,
        endIndex: element.endIndex,
        headingId: paragraph.paragraphStyle?.headingId,
      })
    }
  }

  return { title: doc.title, headings, paragraphCount, endIndex }
}

const OUTLINE_FIELDS =
  'title,body.content(startIndex,endIndex,paragraph(paragraphStyle(namedStyleType,headingId),elements(textRun.content)))'

export async function getDocOutline(client: GoogleClient, fileId: string): Promise<DocOutline> {
  const url = new URL(`${DOCS_API_URL}/${encodeURIComponent(fileId)}`)
  url.searchParams.set('fields', OUTLINE_FIELDS)
  const doc = await client.getJson<RawDocument>(url.toString())
  return summarizeDocument(doc)
}
