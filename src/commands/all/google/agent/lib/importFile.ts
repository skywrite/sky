import * as os from 'node:os'
import * as path from 'node:path'

// Local formats Drive's import conversion turns into a Google Doc — the
// --import gate. Anything else (images, spreadsheets) has other routes.
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
}

export const IMPORT_EXTENSIONS = Object.keys(CONTENT_TYPE_BY_EXT).join(', ')

/** Drive rejects oversized conversions with an opaque error — gate early. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024

export interface ImportSource {
  /** Absolute path, ~/ expanded. */
  filePath: string
  /** Doc title: the file name without its extension. */
  title: string
  contentType: string
}

/** Resolve an --import argument to an upload plan; null when the extension has no Doc conversion. */
export function resolveImportSource(input: string): ImportSource | null {
  const filePath = input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input
  const ext = path.extname(filePath)
  const contentType = CONTENT_TYPE_BY_EXT[ext.toLowerCase()]
  if (!contentType) return null
  return { filePath, title: path.basename(filePath, ext), contentType }
}
