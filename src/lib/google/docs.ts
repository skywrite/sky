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

// ── Tabs ───────────────────────────────────────────────────────────────

// documents.get populates document.tabs (instead of the legacy first-tab-only
// document.body) only when includeTabsContent is set — every fetch below sets
// it. Field masks cannot express recursion, and the editor caps tab nesting
// at three levels, so three explicit childTabs levels cover every tab.

interface RawTabProperties {
  tabId?: string
  title?: string
  /** 0 for root tabs, deeper for nested child tabs. */
  nestingLevel?: number
}

function nestedTabFields(perTab: string, depth = 3): string {
  return depth <= 1 ? perTab : `${perTab},childTabs(${nestedTabFields(perTab, depth - 1)})`
}

const TAB_PROPS_FIELDS = 'tabProperties(tabId,title,nestingLevel)'

/** Tabs flattened to document order: each parent immediately before its children. */
function flattenTabs<T extends { childTabs?: T[] }>(tabs: T[]): T[] {
  const flat: T[] = []
  const walk = (list: T[]): void => {
    for (const tab of list) {
      flat.push(tab)
      walk(tab.childTabs ?? [])
    }
  }
  walk(tabs)
  return flat
}

async function fetchDoc<T>(client: GoogleClient, fileId: string, fields: string): Promise<T> {
  const url = new URL(`${DOCS_API_URL}/${encodeURIComponent(fileId)}`)
  url.searchParams.set('includeTabsContent', 'true')
  url.searchParams.set('fields', fields)
  return await client.getJson<T>(url.toString())
}

export interface DocTabInfo {
  tabId?: string
  title?: string
  nestingLevel?: number
}

const TAB_LIST_FIELDS = `tabs(${nestedTabFields(TAB_PROPS_FIELDS)})`

/** The doc's tabs in document order, properties only — single-tab docs return one entry. */
export async function listDocTabs(client: GoogleClient, fileId: string): Promise<DocTabInfo[]> {
  const doc = await fetchDoc<{ tabs?: RawSuggestTab[] }>(client, fileId, TAB_LIST_FIELDS)
  return flattenTabs(doc.tabs ?? []).map((tab) => ({
    tabId: tab.tabProperties?.tabId,
    title: tab.tabProperties?.title,
    nestingLevel: tab.tabProperties?.nestingLevel,
  }))
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

export interface DocTabOutline {
  tabId?: string
  tabTitle?: string
  /** 0 for root tabs, deeper for nested child tabs. */
  nestingLevel?: number
  headings: DocOutlineEntry[]
  paragraphCount: number
  endIndex?: number
}

export interface DocOutline {
  title?: string
  /** Absent on multi-tab documents — headings live per tab under tabs. */
  headings?: DocOutlineEntry[]
  paragraphCount?: number
  endIndex?: number
  /** Multi-tab documents only: per-tab outlines in document order. Indexes are LOCAL to each tab. */
  tabs?: DocTabOutline[]
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

interface RawOutlineTab {
  tabProperties?: RawTabProperties
  documentTab?: { body?: { content?: RawStructuralElement[] } }
  childTabs?: RawOutlineTab[]
}

interface RawDocument {
  title?: string
  body?: { content?: RawStructuralElement[] }
  tabs?: RawOutlineTab[]
}

function summarizeBody(content: RawStructuralElement[] | undefined): {
  headings: DocOutlineEntry[]
  paragraphCount: number
  endIndex?: number
} {
  const headings: DocOutlineEntry[] = []
  let paragraphCount = 0
  let endIndex: number | undefined

  for (const element of content ?? []) {
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

  return { headings, paragraphCount, endIndex }
}

/**
 * Compact a documents.get response into what the agent needs for range-based
 * styling: headings with their indexes, plus coarse document size. The full
 * JSON tree is far too large to hand to a model. A doc holding several tabs
 * compacts to one outline per tab — indexes in Docs are tab-local.
 */
export function summarizeDocument(doc: RawDocument): DocOutline {
  const tabs = flattenTabs(doc.tabs ?? [])
  if (tabs.length > 1) {
    return {
      title: doc.title,
      tabs: tabs.map((tab) => ({
        tabId: tab.tabProperties?.tabId,
        tabTitle: tab.tabProperties?.title,
        nestingLevel: tab.tabProperties?.nestingLevel,
        ...summarizeBody(tab.documentTab?.body?.content),
      })),
    }
  }
  const body = tabs.length === 1 ? tabs[0]?.documentTab?.body : doc.body
  return { title: doc.title, ...summarizeBody(body?.content) }
}

// The API rejects masks mixing legacy text-level fields (body…) with tabs
// content (probe-verified 400), so the masks request tabs only — the legacy
// body fallbacks in the summarize functions cover pre-tabs response shapes.
const OUTLINE_BODY_FIELDS =
  'body.content(startIndex,endIndex,paragraph(paragraphStyle(namedStyleType,headingId),elements(textRun.content)))'
const OUTLINE_FIELDS = `title,tabs(${nestedTabFields(`${TAB_PROPS_FIELDS},documentTab.${OUTLINE_BODY_FIELDS}`)})`

export async function getDocOutline(client: GoogleClient, fileId: string): Promise<DocOutline> {
  return summarizeDocument(await fetchDoc<RawDocument>(client, fileId, OUTLINE_FIELDS))
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

const SUGGEST_FIELDS = `tabs(${nestedTabFields(`${TAB_PROPS_FIELDS},documentTab.body`)})`

/**
 * Ids of the pending suggested edits in a document, every tab included. The
 * Docs API cannot CREATE suggestions — they only enter through the editor UI
 * (see browserSuggestions.ts) — but it lists them faithfully, so comparing
 * the ids before and after proves a UI-driven suggestion actually landed.
 */
export async function listDocSuggestionIds(client: GoogleClient, fileId: string): Promise<string[]> {
  return collectSuggestionIds(await fetchDoc<unknown>(client, fileId, SUGGEST_FIELDS))
}

export interface DocSuggestion {
  id: string
  /** Text this suggestion strikes out ('' for pure insertions). */
  deletes: string
  /** Text this suggestion adds ('' for pure deletions). */
  inserts: string
  /** Base text just before the change — for locating it in the document. */
  context: string
  /** Set only on docs with several tabs: the tab the suggestion lives in. */
  tabId?: string
  tabTitle?: string
}

interface SuggestParagraphElement {
  textRun?: { content?: string; suggestedInsertionIds?: string[]; suggestedDeletionIds?: string[] }
}

interface SuggestStructuralElement {
  paragraph?: { elements?: SuggestParagraphElement[] }
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: SuggestStructuralElement[] }> }> }
}

interface RawSuggestTab {
  tabProperties?: RawTabProperties
  documentTab?: { body?: { content?: SuggestStructuralElement[] } }
  childTabs?: RawSuggestTab[]
}

interface RawSuggestDocument {
  body?: { content?: SuggestStructuralElement[] }
  tabs?: RawSuggestTab[]
}

/**
 * Compact the pending suggested TEXT edits out of a documents.get response,
 * in reading order, aggregated per suggestion id: a replacement typed over a
 * selection arrives as deletion runs plus insertion runs sharing one id.
 * Context is base text only — inserted text is excluded so it matches what
 * anchoring (the base-text extraction) sees; struck-out text is still base,
 * and it never crosses a tab boundary. Style-only suggestions are not
 * surfaced, and the API carries no authors.
 */
export function summarizeDocSuggestions(doc: RawSuggestDocument): DocSuggestion[] {
  const tabs = flattenTabs(doc.tabs ?? [])
  const sources: Array<{ content: SuggestStructuralElement[]; tab?: RawTabProperties }> =
    tabs.length > 0
      ? tabs.map((tab) => ({ content: tab.documentTab?.body?.content ?? [], tab: tab.tabProperties }))
      : [{ content: doc.body?.content ?? [] }]
  const labelTabs = sources.length > 1

  const byId = new Map<string, DocSuggestion>()
  for (const source of sources) {
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
            if (!byId.has(id)) {
              const suggestion: DocSuggestion = { id, deletes: '', inserts: '', context: tail.trim() }
              if (labelTabs) {
                suggestion.tabId = source.tab?.tabId
                suggestion.tabTitle = source.tab?.title
              }
              byId.set(id, suggestion)
            }
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
    visit(source.content)
  }
  return [...byId.values()]
}

/** The pending suggested text edits in a document (every tab), in reading order. */
export async function listDocSuggestions(client: GoogleClient, fileId: string): Promise<DocSuggestion[]> {
  return summarizeDocSuggestions(await fetchDoc<RawSuggestDocument>(client, fileId, SUGGEST_FIELDS))
}

// ── Per-tab text (anchoring and tab reads) ─────────────────────────────

export interface DocTabText {
  tabId?: string
  tabTitle?: string
  nestingLevel?: number
  /** The tab's base text: pending suggested insertions excluded, struck-out text kept — what find-bar anchoring sees. */
  text: string
}

/** Base text of structural elements — the document as it reads with every pending suggestion rejected. */
export function extractBaseText(content: SuggestStructuralElement[]): string {
  let text = ''
  const visit = (elements: SuggestStructuralElement[]): void => {
    for (const element of elements) {
      for (const pe of element.paragraph?.elements ?? []) {
        const run = pe.textRun
        if (!run?.content) continue
        if ((run.suggestedInsertionIds ?? []).length > 0) continue
        text += run.content
      }
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) visit(cell.content ?? [])
      }
    }
  }
  visit(content)
  return text
}

/** Every tab's base text in document order — single-tab docs return one entry. */
export async function getDocTabTexts(client: GoogleClient, fileId: string): Promise<DocTabText[]> {
  const doc = await fetchDoc<RawSuggestDocument>(client, fileId, SUGGEST_FIELDS)
  const tabs = flattenTabs(doc.tabs ?? [])
  if (tabs.length === 0) return [{ text: extractBaseText(doc.body?.content ?? []) }]
  return tabs.map((tab) => ({
    tabId: tab.tabProperties?.tabId,
    tabTitle: tab.tabProperties?.title,
    nestingLevel: tab.tabProperties?.nestingLevel,
    text: extractBaseText(tab.documentTab?.body?.content ?? []),
  }))
}
