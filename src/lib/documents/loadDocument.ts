/**
 * Load a document off disk into what a model can read: PDFs and images as
 * bytes (they travel as native file parts), everything else as text — Office
 * and Apple formats converted on the way (macOS textutil, pandoc, SheetJS).
 *
 * Shared by summary:doc (a one-shot summary) and ai:chat's read_file tool
 * (the document joins the conversation). The extension tables here are the
 * one place that says what sky can read.
 */

import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as XLSX from 'xlsx'
import { isCommandAvailable, runCommand } from '#lib/sys/command.ts'

/** Sent as a native PDF file part */
export const PDF_EXTENSIONS: ReadonlySet<string> = new Set(['.pdf'])

/** Sent as a native image part */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

/** Read directly as text */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.csv',
  '.md',
  '.txt',
  '.json',
  '.xml',
  '.html',
  '.htm',
  '.yaml',
  '.yml',
  '.toml',
  '.log',
  '.tsv',
])

/** Converted to text via macOS `textutil` */
export const TEXTUTIL_EXTENSIONS: ReadonlySet<string> = new Set(['.docx', '.doc', '.rtf', '.odt', '.pages'])

/** Converted to text via `pandoc` */
export const PANDOC_EXTENSIONS: ReadonlySet<string> = new Set(['.pptx', '.keynote'])

/** Converted to CSV text via SheetJS */
export const SPREADSHEET_EXTENSIONS: ReadonlySet<string> = new Set(['.xlsx', '.xls', '.numbers'])

export type LoadedDocument =
  | { kind: 'pdf'; data: Uint8Array; mediaType: 'application/pdf' }
  | { kind: 'image'; data: Uint8Array; mediaType: string }
  | { kind: 'text'; text: string }

export type LoadDocumentResult = { success: true; document: LoadedDocument } | { success: false; error: string }

export function imageMediaType(ext: string): string {
  const lower = ext.toLowerCase()
  if (lower === '.jpg' || lower === '.jpeg') return 'image/jpeg'
  if (lower === '.webp') return 'image/webp'
  if (lower === '.gif') return 'image/gif'
  return 'image/png'
}

/** What the load is about to do, for a progress line: "Reading PDF", "Converting .docx via textutil". */
export function loadLabel(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (PDF_EXTENSIONS.has(ext)) return 'Reading PDF'
  if (IMAGE_EXTENSIONS.has(ext)) return 'Reading image'
  if (TEXTUTIL_EXTENSIONS.has(ext)) return `Converting ${ext} via textutil`
  if (PANDOC_EXTENSIONS.has(ext)) return `Converting ${ext} via pandoc`
  if (SPREADSHEET_EXTENSIONS.has(ext)) return `Converting ${ext} via SheetJS`
  if (TEXT_EXTENSIONS.has(ext)) return `Reading ${ext.slice(1).toUpperCase()} file`
  return 'Reading text file'
}

/** Bytes inspected for NUL when an unknown extension is read as text. */
const BINARY_SNIFF_BYTES = 8192

/**
 * Read a document. Known formats load by extension; anything else is read as
 * text unless its head carries NUL bytes, which marks a binary sky has no
 * reader for. Failures come back as messages — a missing file, a converter
 * that is not installed, a spreadsheet with no data — never as throws.
 */
export async function loadDocument(filePath: string): Promise<LoadDocumentResult> {
  const ext = path.extname(filePath).toLowerCase()

  if (PDF_EXTENSIONS.has(ext)) {
    const bytes = await readBytes(filePath, 'PDF')
    if (!bytes.success) return bytes
    return { success: true, document: { kind: 'pdf', data: bytes.data, mediaType: 'application/pdf' } }
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    const bytes = await readBytes(filePath, 'image')
    if (!bytes.success) return bytes
    return { success: true, document: { kind: 'image', data: bytes.data, mediaType: imageMediaType(ext) } }
  }

  let converted: TextResult
  if (TEXTUTIL_EXTENSIONS.has(ext)) {
    converted = await convertWithTextutil(filePath)
  } else if (PANDOC_EXTENSIONS.has(ext)) {
    converted = await convertWithPandoc(filePath)
  } else if (SPREADSHEET_EXTENSIONS.has(ext)) {
    converted = await convertSpreadsheet(filePath)
  } else {
    converted = await readAsText(filePath, !TEXT_EXTENSIONS.has(ext))
  }
  if (!converted.success) return converted

  if (converted.text.trim().length === 0) {
    return { success: false, error: 'File is empty or conversion produced no text' }
  }
  return { success: true, document: { kind: 'text', text: converted.text } }
}

type TextResult = { success: true; text: string } | { success: false; error: string }

async function readBytes(
  filePath: string,
  label: string,
): Promise<{ success: true; data: Uint8Array } | { success: false; error: string }> {
  try {
    return { success: true, data: await readFile(filePath) }
  } catch (err) {
    return { success: false, error: `Failed to read ${label}: ${filePath} (${(err as Error).message})` }
  }
}

async function readAsText(filePath: string, sniffBinary: boolean): Promise<TextResult> {
  let data: Uint8Array
  try {
    data = await readFile(filePath)
  } catch (err) {
    return { success: false, error: `Failed to read file: ${filePath} (${(err as Error).message})` }
  }
  if (sniffBinary && data.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return {
      success: false,
      error: `${path.basename(filePath)} is a binary file sky cannot read as text. Readable: PDF, images, Word/Pages, PowerPoint/Keynote, Excel/Numbers, and text formats.`,
    }
  }
  return { success: true, text: new TextDecoder().decode(data) }
}

/** Convert docx, doc, rtf, odt, pages to plain text via macOS textutil */
async function convertWithTextutil(filePath: string): Promise<TextResult> {
  const result = await runCommand('textutil', ['-convert', 'txt', '-stdout', filePath])
  if (!result.success) return { success: false, error: `textutil failed: ${result.stderr}` }
  return { success: true, text: result.stdout }
}

/** Convert pptx, keynote to plain text via pandoc */
async function convertWithPandoc(filePath: string): Promise<TextResult> {
  if (!(await isCommandAvailable('pandoc'))) {
    return { success: false, error: 'pandoc is not installed. Install with: brew install pandoc' }
  }
  const result = await runCommand('pandoc', [filePath, '-t', 'plain'])
  if (!result.success) return { success: false, error: `pandoc failed: ${result.stderr}` }
  return { success: true, text: result.stdout }
}

/** Convert xlsx, xls, numbers to CSV text via SheetJS */
async function convertSpreadsheet(filePath: string): Promise<TextResult> {
  try {
    const data = await readFile(filePath)
    const workbook = XLSX.read(data)
    const parts: string[] = []

    for (const sheetName of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])
      if (!csv.trim()) continue
      if (workbook.SheetNames.length > 1) parts.push(`## Sheet: ${sheetName}\n`)
      parts.push(csv)
      parts.push('')
    }

    if (parts.length === 0) return { success: false, error: 'Spreadsheet contains no data' }
    return { success: true, text: parts.join('\n') }
  } catch (err) {
    return { success: false, error: `Failed to read spreadsheet: ${(err as Error).message}` }
  }
}
