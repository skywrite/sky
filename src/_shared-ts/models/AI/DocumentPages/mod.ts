/**
 * Document pages for models — the one definition of "this notebook file as
 * a model reads it", shared by the service route that serves pages and by
 * the clients that page through them.
 *
 * The text a model reads is the file with its HTML comments removed (a saved
 * chat's `<!-- CONTEXT-LOG -->` block is 90%+ of the file). Offsets are
 * positions in THAT text, so a page's `nextOffset` means the same characters
 * on the next request as long as the file is unchanged; `version` is the
 * text's digest, so a reader can tell a shifted offset from a stale one.
 */

import { createHash } from 'node:crypto'
import _stripHtmlComments from '#shared/models/Markdown/Document/_stripHtmlComments.ts'
import truncate from '#shared/strings/truncate.ts'

/** The most characters one page carries. */
export const DOC_MAX_CHARS = 24_000
/** A `find` hit is shown with this much text before it, when the document has it. */
export const FIND_LEAD_CHARS = 1000

export interface DocumentPageRequest {
  /** Notebook-relative or absolute path inside the notebook. */
  path: string
  /** Start here, or search for `find` from here. Defaults to 0. */
  offset?: number
  /** Page size in characters, capped at DOC_MAX_CHARS. */
  length?: number
  /** Literal text to locate, ignoring case; the page starts shortly before it. */
  find?: string
}

export interface DocumentPage {
  /** Notebook-relative path */
  path: string
  /** The page's text */
  markdown: string
  /** Where the page starts in the document's text */
  offset: number
  /** Length of the whole document's text */
  totalChars: number
  /** Where the next page starts; absent on the last page */
  nextOffset?: number
  /** True when the page is not the whole document */
  truncated: boolean
  /** Digest of the document's text — the same text yields the same version */
  version?: string
}

/** `find` located nothing at or after the offset. */
export interface DocumentPageMiss {
  path: string
  found: false
  totalChars: number
  version: string
  note: string
}

/** The document could not be read at all. */
export interface DocumentPageError {
  path: string
  error: string
}

export type DocumentPageResult = DocumentPage | DocumentPageMiss | DocumentPageError

export function isDocumentPage(result: DocumentPageResult): result is DocumentPage {
  return 'markdown' in result
}

/** The file as a model reads it: HTML comments removed, fenced code untouched. */
export function cleanDocumentText(raw: string): string {
  return _stripHtmlComments(raw)
}

/** A short digest of the text; two readers holding the same version hold the same characters. */
export function textVersion(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

/** Index of `find` at or after `from`, ignoring case; undefined when absent. */
export function locateText(text: string, find: string, from = 0): number | undefined {
  const search = new RegExp(RegExp.escape(find), 'giu')
  search.lastIndex = Math.max(0, Math.floor(from))
  return search.exec(text)?.index
}

/** One page of a document's text from `offset`. Never splits a surrogate pair. */
export function documentPage(path: string, text: string, offset = 0, maxChars = DOC_MAX_CHARS): DocumentPage {
  let start = Math.min(Math.max(0, Math.floor(offset)), text.length)
  const first = text.charCodeAt(start)
  if (first >= 0xdc00 && first <= 0xdfff) start--
  const markdown = truncate(text.slice(start), Math.min(Math.max(1, Math.floor(maxChars)), DOC_MAX_CHARS))
  const end = start + markdown.length
  return {
    path,
    markdown,
    offset: start,
    totalChars: text.length,
    ...(end < text.length ? { nextOffset: end } : {}),
    truncated: start > 0 || end < text.length,
  }
}

/**
 * Answer one page request over a document's clean text: a page, or a miss
 * when `find` is present and absent from the text at or after the offset.
 */
export function pageOf(
  path: string,
  text: string,
  request: Omit<DocumentPageRequest, 'path'>,
): DocumentPage | DocumentPageMiss {
  const version = textVersion(text)
  let offset = request.offset ?? 0
  if (request.find) {
    const at = locateText(text, request.find, offset)
    if (at === undefined) {
      return { path, found: false, totalChars: text.length, version, note: 'Text not found at or after this offset.' }
    }
    offset = Math.max(offset, at - FIND_LEAD_CHARS)
  }
  return { ...documentPage(path, text, offset, request.length ?? DOC_MAX_CHARS), version }
}
