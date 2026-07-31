import type { GoogleClient } from './client.ts'
import { validateBatchRequests } from './batchValidate.ts'

export const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets'

/** batchUpdate request kinds the agent may emit against Sheets. */
export const SHEETS_ALLOWED_REQUESTS = new Set([
  'updateCells',
  'repeatCell',
  'addSheet',
  'deleteSheet',
  'updateSheetProperties',
  'updateSpreadsheetProperties',
  'updateBorders',
  'mergeCells',
  'unmergeCells',
  'autoResizeDimensions',
  'updateDimensionProperties',
  'insertDimension',
  'deleteDimension',
  'appendDimension',
  'addChart',
  'updateChartSpec',
  'deleteEmbeddedObject',
  'updateEmbeddedObjectPosition',
  'setBasicFilter',
  'sortRange',
  'addConditionalFormatRule',
  'addBanding',
  'updateBanding',
  'deleteBanding',
  'setDataValidation',
])

const MAX_REQUESTS_PER_BATCH = 100

export function validateSheetsRequests(requests: unknown): string | null {
  return validateBatchRequests(requests, SHEETS_ALLOWED_REQUESTS, MAX_REQUESTS_PER_BATCH)
}

export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}

export interface CreatedSpreadsheet {
  spreadsheetId: string
  spreadsheetUrl?: string
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>
}

export async function createSpreadsheet(client: GoogleClient, title: string): Promise<CreatedSpreadsheet> {
  return await client.postJson<CreatedSpreadsheet>(SHEETS_API_URL, { properties: { title } })
}

/** Apply validated batchUpdate requests; returns the raw replies (addChart replies carry chartIds). */
export async function batchUpdateSpreadsheet(
  client: GoogleClient,
  spreadsheetId: string,
  requests: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const body = await client.postJson<{ replies?: Array<Record<string, unknown>> }>(
    `${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    { requests },
  )
  return body.replies ?? []
}

/** Chart ids minted by addChart requests in a batchUpdate reply set. */
export function extractChartIds(replies: Array<Record<string, unknown>>): number[] {
  const ids: number[] = []
  for (const reply of replies) {
    const chartId = (reply.addChart as { chart?: { chartId?: unknown } } | undefined)?.chart?.chartId
    if (typeof chartId === 'number') ids.push(chartId)
  }
  return ids
}

export interface UpdatedValues {
  updatedRange?: string
  updatedRows?: number
  updatedColumns?: number
  updatedCells?: number
}

/**
 * Write a 2D value array with USER_ENTERED semantics: numbers stay numbers,
 * strings starting with `=` become live formulas — Google is the evaluator.
 */
export async function setValues(
  client: GoogleClient,
  spreadsheetId: string,
  range: string,
  values: unknown[][],
): Promise<UpdatedValues> {
  const url = new URL(`${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`)
  url.searchParams.set('valueInputOption', 'USER_ENTERED')
  return await client.putJson<UpdatedValues>(url.toString(), { range, majorDimension: 'ROWS', values })
}

export async function getValues(client: GoogleClient, spreadsheetId: string, range: string): Promise<unknown[][]> {
  const url = `${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
  const body = await client.getJson<{ values?: unknown[][] }>(url)
  return body.values ?? []
}

// ── Outline (compact view of spreadsheets.get for the agent) ───────────

export interface SheetTabSummary {
  sheetId: number
  title: string
  rows?: number
  columns?: number
  charts: Array<{ chartId: number; title?: string }>
}

export interface SpreadsheetOutline {
  spreadsheetId: string
  title?: string
  sheets: SheetTabSummary[]
}

interface RawSheet {
  properties?: {
    sheetId?: number
    title?: string
    gridProperties?: { rowCount?: number; columnCount?: number }
  }
  charts?: Array<{ chartId?: number; spec?: { title?: string } }>
}

interface RawSpreadsheet {
  spreadsheetId?: string
  properties?: { title?: string }
  sheets?: RawSheet[]
}

export function summarizeSpreadsheet(raw: RawSpreadsheet): SpreadsheetOutline {
  return {
    spreadsheetId: raw.spreadsheetId ?? '',
    title: raw.properties?.title,
    sheets: (raw.sheets ?? []).map((sheet) => ({
      sheetId: sheet.properties?.sheetId ?? 0,
      title: sheet.properties?.title ?? '',
      rows: sheet.properties?.gridProperties?.rowCount,
      columns: sheet.properties?.gridProperties?.columnCount,
      charts: (sheet.charts ?? [])
        .filter((chart) => typeof chart.chartId === 'number')
        .map((chart) => ({ chartId: chart.chartId as number, title: chart.spec?.title })),
    })),
  }
}

const OUTLINE_FIELDS =
  'spreadsheetId,properties.title,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),charts(chartId,spec.title))'

export async function getSpreadsheetOutline(client: GoogleClient, spreadsheetId: string): Promise<SpreadsheetOutline> {
  const url = new URL(`${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}`)
  url.searchParams.set('fields', OUTLINE_FIELDS)
  const raw = await client.getJson<RawSpreadsheet>(url.toString())
  return summarizeSpreadsheet(raw)
}
