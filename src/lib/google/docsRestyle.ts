import { GoogleApiError } from './client.ts'
import type { GoogleClient } from './client.ts'
import {
  MAX_REQUESTS_PER_BATCH,
  TAB_PROPS_FIELDS,
  batchUpdateDoc,
  fetchDoc,
  flattenTabs,
  nestedTabFields,
} from './docs.ts'

/**
 * Typography by paragraph role, deterministically: one font family over a
 * Doc and point sizes per role, applied as plain updateTextStyle ranges and
 * proved by reading the document back. What a model used to hand-build over
 * dozens of steps — and could never verify — is one call here.
 *
 * Roles come from structure alone: the paragraph's named style (title,
 * subtitle, heading levels, normal text) and, inside tables, the row —
 * header rows (flagged as such, else the first row) against the rest. Only
 * the fields the spec names change; bold, italic, colors, fills, alignment
 * and content are never touched. Headers, footers and footnotes are separate
 * segments and are left alone.
 */

export const RESTYLE_ROLES = [
  'title',
  'subtitle',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'body',
  'tableHeader',
  'tableCell',
] as const
export type RestyleRole = (typeof RESTYLE_ROLES)[number]

export interface RestyleSpec {
  /** One font for every text run — any Google Fonts name. */
  fontFamily?: string
  /** Point sizes by role; roles left out keep their size. Table roles fall back to body. */
  sizes?: Partial<Record<RestyleRole, number>>
  /** Only these tabs; default every tab. */
  tabIds?: string[]
}

const MIN_PT = 1
const MAX_PT = 400

/** Returns a readable problem with the spec, or null when it can run. */
export function validateRestyleSpec(spec: unknown): string | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'the restyle spec must be an object'
  const { fontFamily, sizes, tabIds } = spec as Record<string, unknown>
  if (fontFamily !== undefined && (typeof fontFamily !== 'string' || !fontFamily.trim())) {
    return 'fontFamily must be a font name'
  }
  let sized = 0
  if (sizes !== undefined) {
    if (!sizes || typeof sizes !== 'object' || Array.isArray(sizes)) return 'sizes must map roles to point sizes'
    for (const [role, value] of Object.entries(sizes)) {
      if (!(RESTYLE_ROLES as readonly string[]).includes(role)) {
        return `unknown role "${role}" in sizes — roles: ${RESTYLE_ROLES.join(', ')}`
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_PT || value > MAX_PT) {
        return `sizes.${role} must be a point size between ${MIN_PT} and ${MAX_PT}`
      }
      sized++
    }
  }
  if (fontFamily === undefined && sized === 0) return 'pass fontFamily, sizes, or both — there is nothing to change'
  if (tabIds !== undefined && (!Array.isArray(tabIds) || tabIds.some((id) => typeof id !== 'string' || !id))) {
    return 'tabIds must be a list of tab ids'
  }
  return null
}

/** The spec as a short human line: `Inter; title 24pt, heading1 18pt, body 11pt`. */
export function describeRestyleSpec(spec: RestyleSpec): string {
  const sizes = RESTYLE_ROLES.filter((role) => spec.sizes?.[role] !== undefined).map(
    (role) => `${role} ${spec.sizes?.[role]}pt`,
  )
  return [spec.fontFamily?.trim(), sizes.join(', ')].filter(Boolean).join('; ')
}

// ── The documents.get shape this module reads ──────────────────────────

interface RawTextStyle {
  weightedFontFamily?: { fontFamily?: string }
  fontSize?: { magnitude?: number; unit?: string }
}

interface RawElement {
  startIndex?: number
  endIndex?: number
  textRun?: { content?: string; textStyle?: RawTextStyle }
}

interface RawParagraph {
  paragraphStyle?: { namedStyleType?: string }
  elements?: RawElement[]
}

interface RawCell {
  content?: RawStructural[]
}

interface RawRow {
  tableRowStyle?: { tableHeader?: boolean }
  tableCells?: RawCell[]
}

interface RawStructural {
  startIndex?: number
  endIndex?: number
  paragraph?: RawParagraph
  table?: { tableRows?: RawRow[] }
  tableOfContents?: { content?: RawStructural[] }
}

interface RawNamedStyles {
  styles?: Array<{ namedStyleType?: string; textStyle?: RawTextStyle }>
}

interface RawRestyleTab {
  tabProperties?: { tabId?: string; title?: string }
  documentTab?: { body?: { content?: RawStructural[] }; namedStyles?: RawNamedStyles }
  childTabs?: RawRestyleTab[]
}

export interface RawRestyleDocument {
  title?: string
  /** Pre-tabs response shape; every fetch here asks for tabs. */
  body?: { content?: RawStructural[] }
  namedStyles?: RawNamedStyles
  tabs?: RawRestyleTab[]
}

const RESTYLE_FIELDS = `title,tabs(${nestedTabFields(`${TAB_PROPS_FIELDS},documentTab(body,namedStyles)`)})`

interface Segment {
  tabId?: string
  title?: string
  content: RawStructural[]
  named?: RawNamedStyles
}

function segmentsOf(doc: RawRestyleDocument, tabIds?: string[]): Segment[] {
  const tabs = flattenTabs(doc.tabs ?? [])
  if (tabs.length === 0) return [{ content: doc.body?.content ?? [], named: doc.namedStyles }]
  return tabs
    .filter((tab) => !tabIds || tabIds.includes(tab.tabProperties?.tabId ?? ''))
    .map((tab) => ({
      tabId: tab.tabProperties?.tabId,
      title: tab.tabProperties?.title,
      content: tab.documentTab?.body?.content ?? [],
      named: tab.documentTab?.namedStyles,
    }))
}

/** Requested tab ids the document does not have. */
export function unknownTabIds(doc: RawRestyleDocument, tabIds: string[]): string[] {
  const known = new Set(flattenTabs(doc.tabs ?? []).map((tab) => tab.tabProperties?.tabId))
  return tabIds.filter((id) => !known.has(id))
}

// ── Roles ──────────────────────────────────────────────────────────────

function roleOfStyle(namedStyleType: string | undefined): RestyleRole | undefined {
  if (!namedStyleType || namedStyleType === 'NORMAL_TEXT') return 'body'
  if (namedStyleType === 'TITLE') return 'title'
  if (namedStyleType === 'SUBTITLE') return 'subtitle'
  const level = /^HEADING_([1-6])$/.exec(namedStyleType)?.[1]
  return level ? (`heading${level}` as RestyleRole) : undefined
}

function paragraphSize(spec: RestyleSpec, paragraph: RawParagraph): number | undefined {
  const role = roleOfStyle(paragraph.paragraphStyle?.namedStyleType)
  return role ? spec.sizes?.[role] : undefined
}

/** Inside tables the row decides: header rows, then the rest; both fall back to body. */
function tableSizes(spec: RestyleSpec): { cell?: number; header?: number } {
  const cell = spec.sizes?.tableCell ?? spec.sizes?.body
  return { cell, header: spec.sizes?.tableHeader ?? cell }
}

/** Rows flagged as header; when none is, the first row. */
function headerRowIndexes(rows: RawRow[]): Set<number> {
  const flagged = new Set(rows.flatMap((row, i) => (row.tableRowStyle?.tableHeader ? [i] : [])))
  if (flagged.size === 0 && rows.length > 0) flagged.add(0)
  return flagged
}

function cellContents(rows: RawRow[]): RawStructural[] {
  return rows.flatMap((row) => (row.tableCells ?? []).flatMap((cell) => cell.content ?? []))
}

/** Every paragraph under these elements, tables and contents included, in order. */
function paragraphsIn(content: RawStructural[]): RawStructural[] {
  return content.flatMap((element) => {
    if (element.paragraph) return [element]
    if (element.table) return paragraphsIn(cellContents(element.table.tableRows ?? []))
    if (element.tableOfContents) return paragraphsIn(element.tableOfContents.content ?? [])
    return []
  })
}

/** From the first paragraph's start to the last paragraph's end — structural marks at the edges excluded. */
function textBounds(content: RawStructural[]): { start: number; end: number } | null {
  let start: number | undefined
  let end: number | undefined
  for (const paragraph of paragraphsIn(content)) {
    if (paragraph.startIndex === undefined || paragraph.endIndex === undefined) continue
    start = start === undefined ? paragraph.startIndex : Math.min(start, paragraph.startIndex)
    end = end === undefined ? paragraph.endIndex : Math.max(end, paragraph.endIndex)
  }
  return start === undefined || end === undefined ? null : { start, end }
}

// ── Planning ───────────────────────────────────────────────────────────

export interface DocRange {
  startIndex: number
  endIndex: number
  tabId?: string
}

export type DocsRequest = Record<string, unknown>

export interface PlannedRequest {
  request: DocsRequest
  /** One range per paragraph, for when the API refuses a range spanning table cells. */
  expand?: DocRange[]
}

export interface RestyleTabPlan {
  tabId?: string
  title?: string
  paragraphs: number
}

export interface RestylePlan {
  tabs: RestyleTabPlan[]
  requests: PlannedRequest[]
}

function styleRequest(range: DocRange, textStyle: RawTextStyle, fields: string): DocsRequest {
  return { updateTextStyle: { range, textStyle, fields } }
}

function sizeRequest(range: DocRange, size: number): DocsRequest {
  return styleRequest(range, { fontSize: { magnitude: size, unit: 'PT' } }, 'fontSize')
}

function withRange(request: DocsRequest, range: DocRange): DocsRequest {
  const inner = request.updateTextStyle as Record<string, unknown>
  return { updateTextStyle: { ...inner, range } }
}

/**
 * The updateTextStyle requests that put the spec on one document, in the
 * order they must apply. Per tab: the font family over the whole text, then
 * sizes — adjacent paragraphs of one size share a range, each table gets one
 * range for its cells and one per header row. The segment's final newline is
 * never in a range.
 */
export function planRestyle(doc: RawRestyleDocument, spec: RestyleSpec): RestylePlan {
  const plan: RestylePlan = { tabs: [], requests: [] }
  for (const segment of segmentsOf(doc, spec.tabIds)) {
    const bounds = textBounds(segment.content)
    const paragraphs = paragraphsIn(segment.content).length
    plan.tabs.push({ tabId: segment.tabId, title: segment.title, paragraphs })
    if (!bounds || bounds.end - 1 <= bounds.start) continue
    const cap = bounds.end - 1
    const range = (start: number, end: number): DocRange => ({
      startIndex: start,
      endIndex: Math.min(end, cap),
      ...(segment.tabId ? { tabId: segment.tabId } : {}),
    })
    const paragraphRanges = (content: RawStructural[]): DocRange[] =>
      paragraphsIn(content)
        .filter((p) => p.startIndex !== undefined && p.endIndex !== undefined)
        .map((p) => range(p.startIndex!, p.endIndex!))
        .filter((r) => r.endIndex > r.startIndex)

    if (spec.fontFamily?.trim()) {
      plan.requests.push({
        request: styleRequest(
          range(bounds.start, bounds.end),
          { weightedFontFamily: { fontFamily: spec.fontFamily.trim() } },
          'weightedFontFamily',
        ),
      })
    }

    let run: { start: number; end: number; size: number } | null = null
    const flush = () => {
      if (run && Math.min(run.end, cap) > run.start) {
        plan.requests.push({ request: sizeRequest(range(run.start, run.end), run.size) })
      }
      run = null
    }
    for (const element of segment.content) {
      if (element.paragraph) {
        const size = paragraphSize(spec, element.paragraph)
        if (size === undefined || element.startIndex === undefined || element.endIndex === undefined) {
          flush()
          continue
        }
        if (run && run.size === size && run.end === element.startIndex) {
          run.end = element.endIndex
        } else {
          flush()
          run = { start: element.startIndex, end: element.endIndex, size }
        }
        continue
      }
      flush()
      if (!element.table) continue
      const rows = element.table.tableRows ?? []
      const { cell, header } = tableSizes(spec)
      const tableBounds = textBounds(cellContents(rows))
      if (cell !== undefined && tableBounds) {
        plan.requests.push({
          request: sizeRequest(range(tableBounds.start, tableBounds.end), cell),
          expand: paragraphRanges(cellContents(rows)),
        })
      }
      if (header === undefined || header === cell) continue
      for (const i of headerRowIndexes(rows)) {
        const rowContent = cellContents([rows[i]!])
        const rowBounds = textBounds(rowContent)
        if (!rowBounds) continue
        plan.requests.push({
          request: sizeRequest(range(rowBounds.start, rowBounds.end), header),
          expand: paragraphRanges(rowContent),
        })
      }
    }
    flush()
  }
  return plan
}

export function batchesOf<T>(items: T[], size = MAX_REQUESTS_PER_BATCH): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

// ── Read-back ──────────────────────────────────────────────────────────

export interface RestyleMismatch {
  tab?: string
  text: string
  fontFamily: string
  fontSize: number
  expected: { fontFamily?: string; fontSize?: number }
}

export interface RestyleCheck {
  /** Text runs with visible text, tables of contents excluded. */
  runs: number
  matching: number
  /** The first mismatches, at most MAX_MISMATCHES. */
  off: RestyleMismatch[]
  /** Runs inside tables of contents — Docs regenerates those, so they are not judged. */
  skipped: number
}

const MAX_MISMATCHES = 10
const DEFAULT_FONT = 'Arial'
const DEFAULT_SIZE = 11

/**
 * What a run renders as: its own style, else its paragraph's named style,
 * else NORMAL_TEXT, else the Docs defaults. The API sets a field to inherit
 * when a request writes the parent's value, so read-back must resolve.
 */
function styleResolver(named?: RawNamedStyles) {
  const byType = new Map(named?.styles?.map((s) => [s.namedStyleType, s.textStyle] as const) ?? [])
  const normal = byType.get('NORMAL_TEXT')
  return (namedStyleType: string | undefined, run?: RawTextStyle): { fontFamily: string; fontSize: number } => {
    const own = namedStyleType ? byType.get(namedStyleType) : undefined
    return {
      fontFamily:
        run?.weightedFontFamily?.fontFamily ??
        own?.weightedFontFamily?.fontFamily ??
        normal?.weightedFontFamily?.fontFamily ??
        DEFAULT_FONT,
      fontSize: run?.fontSize?.magnitude ?? own?.fontSize?.magnitude ?? normal?.fontSize?.magnitude ?? DEFAULT_SIZE,
    }
  }
}

function visibleRuns(paragraph: RawParagraph): Array<{ text: string; style?: RawTextStyle }> {
  return (paragraph.elements ?? []).flatMap((element) => {
    const text = element.textRun?.content ?? ''
    return text.trim() ? [{ text, style: element.textRun?.textStyle }] : []
  })
}

/** Every visible text run judged against the spec — the proof the restyle landed. */
export function checkRestyle(doc: RawRestyleDocument, spec: RestyleSpec): RestyleCheck {
  const check: RestyleCheck = { runs: 0, matching: 0, off: [], skipped: 0 }
  const family = spec.fontFamily?.trim()
  const { cell, header } = tableSizes(spec)
  for (const segment of segmentsOf(doc, spec.tabIds)) {
    const resolve = styleResolver(segment.named)
    const judge = (paragraph: RawParagraph, expectedSize: number | undefined) => {
      const expected = { fontFamily: family, fontSize: expectedSize }
      for (const run of visibleRuns(paragraph)) {
        check.runs++
        const actual = resolve(paragraph.paragraphStyle?.namedStyleType, run.style)
        const ok =
          (family === undefined || actual.fontFamily === family) &&
          (expectedSize === undefined || actual.fontSize === expectedSize)
        if (ok) check.matching++
        else if (check.off.length < MAX_MISMATCHES) {
          check.off.push({ tab: segment.title, text: run.text.trim().slice(0, 40), ...actual, expected })
        }
      }
    }
    // The outermost table decides a paragraph's row role — nested tables ride along.
    const walk = (content: RawStructural[], inTable?: { header: boolean }) => {
      for (const element of content) {
        if (element.paragraph) {
          const size = inTable ? (inTable.header ? header : cell) : paragraphSize(spec, element.paragraph)
          judge(element.paragraph, size)
        } else if (element.table) {
          const rows = element.table.tableRows ?? []
          const headers = headerRowIndexes(rows)
          rows.forEach((row, i) => {
            for (const tableCell of row.tableCells ?? []) {
              walk(tableCell.content ?? [], inTable ?? { header: headers.has(i) })
            }
          })
        } else if (element.tableOfContents) {
          for (const paragraph of paragraphsIn(element.tableOfContents.content ?? [])) {
            check.skipped += visibleRuns(paragraph.paragraph!).length
          }
        }
      }
    }
    walk(segment.content)
  }
  return check
}

// ── The whole pass ─────────────────────────────────────────────────────

export interface RestyleResult {
  title?: string
  tabs: RestyleTabPlan[]
  /** Requests the API applied. */
  applied: number
  batches: number
  check: RestyleCheck
}

async function applyBatch(client: GoogleClient, fileId: string, batch: PlannedRequest[]): Promise<number> {
  try {
    return await batchUpdateDoc(
      client,
      fileId,
      batch.map((p) => p.request),
    )
  } catch (err) {
    // A range spanning table cells is the one shape here the API might
    // refuse; a batch is atomic, so resend it with one range per paragraph.
    if (!(err instanceof GoogleApiError) || err.status !== 400 || !batch.some((p) => p.expand)) throw err
    const expanded = batch.flatMap((p) =>
      p.expand ? p.expand.map((range) => withRange(p.request, range)) : [p.request],
    )
    let applied = 0
    for (const chunk of batchesOf(expanded)) applied += await batchUpdateDoc(client, fileId, chunk)
    return applied
  }
}

/**
 * Plan, apply and prove one restyle. `progress` gets one line per batch so a
 * long pass shows life. Unknown tab ids fail before anything is written.
 */
export async function restyleDoc(
  client: GoogleClient,
  fileId: string,
  spec: RestyleSpec,
  progress?: (line: string) => void,
): Promise<RestyleResult> {
  const doc = await fetchDoc<RawRestyleDocument>(client, fileId, RESTYLE_FIELDS)
  if (spec.tabIds) {
    const unknown = unknownTabIds(doc, spec.tabIds)
    if (unknown.length > 0) {
      const known = flattenTabs(doc.tabs ?? [])
        .map((tab) => `${tab.tabProperties?.tabId} ("${tab.tabProperties?.title ?? 'untitled'}")`)
        .join(', ')
      throw new Error(`no tab ${unknown.join(', ')} in "${doc.title ?? fileId}" — its tabs: ${known}`)
    }
  }
  const plan = planRestyle(doc, spec)
  const batches = batchesOf(plan.requests)
  let applied = 0
  for (const [i, batch] of batches.entries()) {
    progress?.(`Restyling "${doc.title ?? fileId}": batch ${i + 1}/${batches.length} (${batch.length} requests)`)
    applied += await applyBatch(client, fileId, batch)
  }
  const after = applied > 0 ? await fetchDoc<RawRestyleDocument>(client, fileId, RESTYLE_FIELDS) : doc
  return { title: doc.title, tabs: plan.tabs, applied, batches: batches.length, check: checkRestyle(after, spec) }
}
