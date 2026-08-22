import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { DIR_DATA } from '#config'
import { parseDateFromDayPath } from '#shared/nbfs/mod.ts'

const LIFTS_HEADING = 'Lifts'
const CSV_PATH = path.join(DIR_DATA, 'strong', 'strong_workouts.csv')

// TODO: Replace findHeadingLine/findSectionEnd with SectionDocument.findSection() + position offset
// (see summarizeAttachment for the pattern)

/**
 * Find line number where a section heading appears.
 */
function findHeadingLine(lines: string[], heading: string, level: number): number {
  const prefix = '#'.repeat(level) + ' '
  const pattern = new RegExp(`^${prefix}${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i
    }
  }
  return -1
}

/**
 * Find the end of a section (next same-or-higher level heading or EOF).
 */
function findSectionEnd(lines: string[], startLine: number, level: number): number {
  const pattern = new RegExp(`^#{1,${level}} `)

  for (let i = startLine + 1; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i
    }
  }
  return lines.length
}

interface CsvRow {
  date: string
  workoutName: string
  duration: string
  exerciseName: string
  setOrder: string
  weight: string
  reps: string
}

/**
 * Parse a CSV line, handling quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

/**
 * Format a numeric string: remove trailing .0 decimals (205.0 → 205), keep meaningful decimals (2.5 → 2.5).
 */
function formatNumber(value: string): string {
  const num = parseFloat(value)
  if (isNaN(num)) return value
  if (Number.isInteger(num)) return String(Math.round(num))
  return String(num)
}

/**
 * Insert lifts from Strong CSV into the current day file's ## Lifts section.
 */
export default async function insertLifts(): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showWarningMessage('No active editor')
    return
  }

  if (!editor.document.fileName.endsWith('.md')) {
    vscode.window.showWarningMessage('This command only works on Markdown files')
    return
  }

  // Extract date from day file path
  let dateStr: string
  try {
    const plainDate = parseDateFromDayPath(editor.document.fileName)
    dateStr = plainDate.toString() // YYYY-MM-DD
  } catch {
    vscode.window.showWarningMessage('Could not parse date from file path — is this a day file?')
    return
  }

  // Read and parse CSV
  let csvContent: string
  try {
    csvContent = await readFile(CSV_PATH, 'utf-8')
  } catch {
    vscode.window.showErrorMessage(`Could not read Strong CSV at ${CSV_PATH}`)
    return
  }

  const csvLines = csvContent.split('\n').filter((l) => l.trim() !== '')
  if (csvLines.length < 2) {
    vscode.window.showWarningMessage('Strong CSV is empty')
    return
  }

  // Parse rows matching the target date
  const rows: CsvRow[] = []
  for (let i = 1; i < csvLines.length; i++) {
    const fields = parseCsvLine(csvLines[i])
    if (!fields[0].startsWith(dateStr)) continue
    rows.push({
      date: fields[0],
      workoutName: fields[1],
      duration: fields[2],
      exerciseName: fields[3],
      setOrder: fields[4],
      weight: fields[5],
      reps: fields[6],
    })
  }

  if (rows.length === 0) {
    vscode.window.showWarningMessage(`No workouts found for ${dateStr}`)
    return
  }

  // Build markdown content
  const duration = rows[0].duration
  let totalWeight = 0
  for (const row of rows) {
    const w = parseFloat(row.weight) || 0
    const r = parseFloat(row.reps) || 0
    // Strong records per-dumbbell weight; double it for two-handed dumbbell exercises
    const multiplier = row.exerciseName.includes('(Dumbbell)') ? 2 : 1
    totalWeight += w * multiplier * r
  }
  const totalFormatted = Number.isInteger(totalWeight)
    ? totalWeight.toLocaleString()
    : totalWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })

  let md = `## ${LIFTS_HEADING}\n\n`
  md += `**${duration}** — ${totalFormatted} lbs\n\n`
  md += '| Exercise | Set | Weight | Reps | Total |\n'
  md += '|----------|-----|--------|------|-------|\n'

  for (const row of rows) {
    const weight = formatNumber(row.weight)
    const reps = formatNumber(row.reps)
    const w = parseFloat(row.weight) || 0
    const r = parseFloat(row.reps) || 0
    const multiplier = row.exerciseName.includes('(Dumbbell)') ? 2 : 1
    const total = formatNumber(String(w * multiplier * r))
    md += `| ${row.exerciseName} | ${row.setOrder} | ${weight} | ${reps} | ${total} |\n`
  }

  // Insert or replace in document
  const text = editor.document.getText()
  const lines = text.split('\n')

  const existingLine = findHeadingLine(lines, LIFTS_HEADING, 2)

  if (existingLine !== -1) {
    // Replace existing section
    const sectionEnd = findSectionEnd(lines, existingLine, 2)
    const startPos = new vscode.Position(existingLine, 0)
    const endPos = new vscode.Position(sectionEnd, 0)
    const range = new vscode.Range(startPos, endPos)

    await editor.edit((editBuilder) => {
      editBuilder.replace(range, md + '\n')
    })
  } else {
    // Append at end of file
    const lastLine = lines.length
    const position = new vscode.Position(lastLine, 0)
    await editor.edit((editBuilder) => {
      editBuilder.insert(position, '\n' + md)
    })
  }

  vscode.window.showInformationMessage(`Inserted ${rows.length} lift sets for ${dateStr}`)
}
