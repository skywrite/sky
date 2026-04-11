import * as path from 'node:path'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { executeQuery } from '#shared/models/DomainCollection/query/execute.ts'
import ContextAssembler from '#shared/models/AI/ContextAssembler/mod.ts'
import { createJournalScorer, withPinnedPaths } from '#shared/models/AI/ContextAssembler/scorers.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { DIR_BASE, DIR_TIME } from '#config'

/** Token budget for MI context assembly. Goals/decisions are pinned and always
 * kept; day files compete for the remaining budget. */
const MAX_TOKENS = 300_000

export interface MIContext {
  contextMarkdown: string
  today: {
    date: string
    dayOfWeek: string
  }
  documentCount: number
  prunedCount: number
  totalTokens: number
}

const EXTRA_QUERY = `{
  decisions(where: { pending: true }) { path }
  goals { path }
}`

/**
 * Gather context for AI-powered MI suggestions.
 *
 * Day files: last 5 days (all markdown including journals).
 * Plus pending decisions and all goals via GraphQL (pinned — never pruned).
 * Full store scope for relationship traversal.
 */
export async function gatherContext(today: PlainDate): Promise<MIContext> {
  const store = await MarkdownStore.buildFromAll()

  const dayPaths = await gatherDayFiles(today)
  const extraPaths = await gatherExtraPaths(store)

  const allPaths = new Set([...dayPaths, ...extraPaths])
  const docs: Array<{ doc: Document; path: string }> = []
  for (const filePath of allPaths) {
    try {
      const content = await readTextFile(filePath)
      if (content.length < 50) continue
      const doc = Document.fromMarkdown(content).filterSections((h) => !h.text.toLowerCase().includes('transcript'))
      docs.push({ doc, path: filePath })
    } catch {
      /* skip unreadable files */
    }
  }

  const collection = DomainCollection.fromDocuments(docs, store, { depth: 1 })

  // Pin goals + pending decisions so they're never pruned
  const pinnedPaths = new Set(extraPaths)
  const scorer = withPinnedPaths(createJournalScorer(today), pinnedPaths)
  const assembler = ContextAssembler.from(collection, { scorer, maxTokens: MAX_TOKENS })

  const contextMarkdown = assembler.toMarkdown({ relativeTo: DIR_BASE, delimited: true })

  return {
    contextMarkdown,
    today: {
      date: today.ymd,
      dayOfWeek: today.dayLong,
    },
    documentCount: assembler.size,
    prunedCount: assembler.pruned.length,
    totalTokens: assembler.totalTokens,
  }
}

/**
 * Last 5 days of day files — all markdown files including journals.
 */
async function gatherDayFiles(today: PlainDate): Promise<string[]> {
  const paths: string[] = []

  for (let i = 0; i < 5; i++) {
    const date = today.addDays(-i)
    const relDir = dayDir(date)
    const fullDir = path.join(DIR_TIME, relDir)

    if (!(await exists(fullDir))) continue

    for await (const entry of walk(fullDir, { exts: ['.md'] })) {
      paths.push(entry.path)
    }
  }

  return paths
}

async function gatherExtraPaths(store: MarkdownStore): Promise<string[]> {
  const result = await executeQuery<Record<string, Array<{ path: string }>>>(EXTRA_QUERY, store)
  const paths: string[] = []
  if (result.data) {
    for (const entries of Object.values(result.data)) {
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry.path) paths.push(entry.path)
        }
      }
    }
  }
  return paths
}
