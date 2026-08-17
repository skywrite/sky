import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

// Assets to track: [symbol, type]
const TRACKED_ASSETS: Array<[string, 'crypto' | 'equities']> = [
  ['BTC', 'crypto'],
  ['SPY', 'equities'],
  ['EXOD', 'equities'],
]

export interface PriceData {
  symbol: string
  value: number
  when: string
}

export interface DayPriceData {
  prices: PriceData[]
}

export interface WeekPriceCsv {
  symbol: string
  /** Absolute path of the source CSV, for provenance records */
  path: string
  /** Raw CSV content filtered to the requested date range */
  csv: string
}

/**
 * Parse price CSV and find the closest value to a given date.
 * Returns the last value on or before the target date.
 */
function findPriceForDate(csvContent: string, targetDate: PlainDate): { value: number; when: string } | null {
  const lines = csvContent.trim().split('\n')
  if (lines.length < 2) return null

  // Skip header, parse records
  const records: Array<{ when: string; value: number }> = []
  for (let i = 1; i < lines.length; i++) {
    const [when, valueStr] = lines[i].split(',')
    if (when && valueStr) {
      records.push({ when: when.trim(), value: parseFloat(valueStr.trim()) })
    }
  }

  // Find the last record on or before target date
  const targetYmd = targetDate.ymd
  let closest: { when: string; value: number } | null = null

  for (const record of records) {
    const recordDate = record.when.slice(0, 10) // Extract YYYY-MM-DD
    if (recordDate <= targetYmd) {
      closest = record
    } else {
      break // Records are chronological, so we can stop
    }
  }

  return closest
}

/**
 * Filter CSV content to only include rows within the date range.
 */
function filterCsvByDateRange(csvContent: string, start: PlainDate, end: PlainDate): string {
  const lines = csvContent.trim().split('\n')
  if (lines.length < 2) return csvContent

  const header = lines[0]
  const startYmd = start.ymd
  const endYmd = end.ymd

  const filteredLines = [header]
  for (let i = 1; i < lines.length; i++) {
    const when = lines[i].split(',')[0]?.trim()
    if (when) {
      const recordDate = when.slice(0, 10)
      if (recordDate >= startYmd && recordDate <= endYmd) {
        filteredLines.push(lines[i])
      }
    }
  }

  return filteredLines.join('\n')
}

/**
 * Gather price data for a specific day.
 */
export async function gatherDayPriceData(day: PlainDate, dataDir: string): Promise<DayPriceData> {
  const prices: PriceData[] = []
  const year = day.year

  for (const [symbol, type] of TRACKED_ASSETS) {
    const filePath = path.join(dataDir, 'assets', type, String(year), `${symbol}_USD.csv`)
    try {
      const content = await readTextFile(filePath)
      const result = findPriceForDate(content, day)
      if (result) {
        prices.push({
          symbol,
          value: result.value,
          when: result.when,
        })
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }

  return { prices }
}

/**
 * Gather price data for a week range (raw CSV filtered to date range).
 */
export async function gatherWeekPriceData(start: PlainDate, end: PlainDate, dataDir: string): Promise<WeekPriceCsv[]> {
  const csvs: WeekPriceCsv[] = []

  for (const [symbol, type] of TRACKED_ASSETS) {
    const filePath = path.join(dataDir, 'assets', type, String(start.year), `${symbol}_USD.csv`)
    try {
      const content = await readTextFile(filePath)
      csvs.push({ symbol, path: filePath, csv: filterCsvByDateRange(content, start, end) })
    } catch {
      // No data
    }
  }

  return csvs
}
