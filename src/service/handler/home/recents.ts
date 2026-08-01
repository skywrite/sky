import * as path from 'node:path'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { docDate, docTitle } from './docMeta.ts'

export interface RecentDoc {
  relativePath: string
  title: string
  /** YMD */
  date: string
}

/**
 * Most recently dated documents from the time tree, by frontmatter
 * updated/created or day-partition date. Day files themselves are skipped —
 * the Today section already covers them.
 */
export function recentDocuments(store: MarkdownStore, markdownBaseDir: string, limit = 10): RecentDoc[] {
  const dated: RecentDoc[] = []

  for (const filePath of store.time.paths) {
    if (path.basename(filePath) === 'day.md') continue

    const doc = store.time.findByPath(filePath)
    if (!doc) continue

    const date = docDate(doc, filePath)
    if (!date) continue

    dated.push({
      relativePath: path.relative(markdownBaseDir, filePath),
      title: docTitle(doc, filePath),
      date: date.ymd,
    })
  }

  dated.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    return a.relativePath.localeCompare(b.relativePath)
  })

  return dated.slice(0, limit)
}
