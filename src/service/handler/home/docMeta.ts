import * as path from 'node:path'
import type { Document } from '#shared/models/Markdown/mod.ts'
import { parseDateFromDayPath } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

const HEADING_PATTERN = /^#{1,6}\s+(.+?)\s*$/m

/** Display title for a document: frontmatter title/summary, first heading, or filename. */
export function docTitle(doc: Document, filePath: string): string {
  for (const key of ['title', 'summary']) {
    const value = doc.yaml[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }

  const heading = doc.markdown.match(HEADING_PATTERN)
  if (heading?.[1]) return heading[1]

  return path.basename(filePath, '.md')
}

/** Best-known date for a document: frontmatter updated/created, else day-partition path. */
export function docDate(doc: Document, filePath: string): PlainDate | undefined {
  if (doc.updated) return doc.updated
  if (doc.created) return doc.created

  try {
    return parseDateFromDayPath(filePath)
  } catch {
    return undefined
  }
}
