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

// ── Pending suggestions ────────────────────────────────────────────────

/**
 * Every suggestion id under a suggestedInsertionIds/suggestedDeletionIds
 * key, anywhere in a documents.get tree (text runs, paragraph marks, table
 * cells), each once.
 */
export function collectSuggestionIds(node: unknown): string[] {
  const ids = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'suggestedInsertionIds' || key === 'suggestedDeletionIds') && Array.isArray(child)) {
        for (const id of child) if (typeof id === 'string') ids.add(id)
      } else {
        walk(child)
      }
    }
  }
  walk(node)
  return [...ids]
}

/**
 * Ids of the pending suggested edits in a document. The Docs API cannot
 * CREATE suggestions — they only enter through the editor UI (see
 * browserSuggestions.ts) — but it lists them faithfully, so comparing the
 * ids before and after proves a UI-driven suggestion actually landed.
 */
export async function listDocSuggestionIds(client: GoogleClient, fileId: string): Promise<string[]> {
  const url = new URL(`${DOCS_API_URL}/${encodeURIComponent(fileId)}`)
  url.searchParams.set('fields', 'body')
  const doc = await client.getJson<unknown>(url.toString())
  return collectSuggestionIds(doc)
}

export interface DocSuggestion {
  id: string
  /** Text this suggestion strikes out ('' for pure insertions). */
  deletes: string
  /** Text this suggestion adds ('' for pure deletions). */
  inserts: string
  /** Base text just before the change — for locating it in the document. */
  context: string
}

interface SuggestParagraphElement {
  textRun?: { content?: string; suggestedInsertionIds?: string[]; suggestedDeletionIds?: string[] }
}

interface SuggestStructuralElement {
  paragraph?: { elements?: SuggestParagraphElement[] }
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: SuggestStructuralElement[] }> }> }
}

interface RawSuggestDocument {
  body?: { content?: SuggestStructuralElement[] }
}

/**
 * Compact the pending suggested TEXT edits out of a documents.get response,
 * in reading order, aggregated per suggestion id: a replacement typed over a
 * selection arrives as deletion runs plus insertion runs sharing one id.
 * Context is base text only — inserted text is excluded so it matches what
 * anchoring (the plain-text export) sees; struck-out text is still base.
 * Style-only suggestions are not surfaced, and the API carries no authors.
 */
export function summarizeDocSuggestions(doc: RawSuggestDocument): DocSuggestion[] {
  const byId = new Map<string, DocSuggestion>()
  let tail = ''
  const pushBase = (text: string) => {
    tail = (tail + text).slice(-80)
  }
  const visit = (elements: SuggestStructuralElement[]): void => {
    for (const element of elements) {
      for (const pe of element.paragraph?.elements ?? []) {
        const run = pe.textRun
        if (!run?.content) continue
        const inserts = run.suggestedInsertionIds ?? []
        const deletes = run.suggestedDeletionIds ?? []
        if (inserts.length === 0 && deletes.length === 0) {
          pushBase(run.content)
          continue
        }
        for (const id of [...inserts, ...deletes]) {
          if (!byId.has(id)) byId.set(id, { id, deletes: '', inserts: '', context: tail.trim() })
        }
        for (const id of inserts) byId.get(id)!.inserts += run.content
        for (const id of deletes) {
          byId.get(id)!.deletes += run.content
          pushBase(run.content)
        }
      }
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) visit(cell.content ?? [])
      }
    }
  }
  visit(doc.body?.content ?? [])
  return [...byId.values()]
}

/** The pending suggested text edits in a document, in reading order. */
export async function listDocSuggestions(client: GoogleClient, fileId: string): Promise<DocSuggestion[]> {
  const url = new URL(`${DOCS_API_URL}/${encodeURIComponent(fileId)}`)
  url.searchParams.set('fields', 'body')
  const doc = await client.getJson<RawSuggestDocument>(url.toString())
  return summarizeDocSuggestions(doc)
}
