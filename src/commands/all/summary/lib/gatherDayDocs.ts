import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'

/** Where a gathered file sits in the day's reading order. */
export type DayDocKind = 'journal' | 'action' | 'day'

export interface DayDocEntry {
  doc: Document
  path: string
  kind: DayDocKind
}

export interface GatherDayDocsResult {
  /** Ordered for the model: journals → actions chronologically → day.md last. */
  docs: DayDocEntry[]
  /** Relative paths of files left out of the gather, by reason. */
  skipped: {
    tiny: string[]
    yamlError: string[]
    unreadable: string[]
  }
}

const MIN_CONTENT_LENGTH = 50

// Extended-hours prefixes are valid (25-30 = late night still belonging to
// this notebook day) and must sort after 23-xx — plain minutes math, never
// clamp or normalize to 0-23.
const TIME_PREFIX = /^(\d{2})-(\d{2})_/

// Files with no derivable time sort to the end of the action stream. A finite
// sentinel, not Infinity: Infinity - Infinity is NaN, which breaks the sort
// comparator when two untimed files meet.
const UNTIMED = Number.MAX_SAFE_INTEGER

const KIND_ORDER: Record<DayDocKind, number> = { journal: 0, action: 1, day: 2 }

/**
 * Gather one day's markdown files as model-ready, ordered documents.
 *
 * Walks the day directory directly — journals are not linked from day.md, so
 * a link-following gather would miss them. Reading order is the arc the
 * summary prompt expects: journals first (the state the day started in),
 * then actions chronologically (the evidence stream), day.md last so the
 * model reconciles everything it just read against the day's authoritative
 * plan/done record.
 *
 * Every document is stripped of HTML comments before it ships: chat
 * transcripts carry machine CONTEXT-LOG blocks that are routinely 3-4× the
 * size of the actual conversation.
 *
 * summary.md is excluded (it is this pipeline's output). Stub files, files
 * whose YAML fails to parse, and unreadable files are excluded too, but
 * reported in `skipped` rather than dropped silently.
 */
export default async function gatherDayDocs(dayDirPath: string): Promise<GatherDayDocsResult> {
  const filePaths: string[] = []
  try {
    for await (const entry of walk(dayDirPath, { includeDirs: false, exts: ['.md'] })) {
      if (path.basename(entry.path) === 'summary.md') continue
      filePaths.push(entry.path)
    }
  } catch {
    // Day directory doesn't exist — return empty
  }
  filePaths.sort()

  const skipped = { tiny: [] as string[], yamlError: [] as string[], unreadable: [] as string[] }
  const entries: Array<DayDocEntry & { time: number; relPath: string }> = []

  for (const filePath of filePaths) {
    const relPath = path.relative(dayDirPath, filePath)

    let content: string
    try {
      content = await readTextFile(filePath)
    } catch {
      skipped.unreadable.push(relPath)
      continue
    }

    if (content.length < MIN_CONTENT_LENGTH) {
      skipped.tiny.push(relPath)
      continue
    }

    const parsed = Document.fromMarkdown(content)
    if (parsed.yamlError) {
      skipped.yamlError.push(relPath)
      continue
    }

    const kind = classify(relPath)
    entries.push({
      doc: parsed.stripHtmlComments(),
      path: filePath,
      kind,
      time: kind === 'action' ? timeKeyOf(relPath, parsed) : 0,
      relPath,
    })
  }

  entries.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.time - b.time || a.relPath.localeCompare(b.relPath),
  )

  return {
    docs: entries.map((e) => ({ doc: e.doc, path: e.path, kind: e.kind })),
    skipped,
  }
}

function classify(relPath: string): DayDocKind {
  const base = path.basename(relPath)
  if (base === 'day.md' || base === '_day.md') return 'day'
  if (relPath.startsWith('journal/') || base === '_journal.md') return 'journal'
  return 'action'
}

/**
 * Chronological sort key in minutes. Sources, in order: an HH-MM_ filename
 * prefix (messages, chats), else the first HH:MM in the `when:`
 * frontmatter — its start time (meetings).
 */
function timeKeyOf(relPath: string, doc: Document): number {
  const prefix = path.basename(relPath).match(TIME_PREFIX)
  if (prefix) return Number(prefix[1]) * 60 + Number(prefix[2])

  const when = doc.yaml['when']
  if (typeof when === 'string') {
    const start = when.match(/\b(\d{1,2}):(\d{2})\b/)
    if (start) return Number(start[1]) * 60 + Number(start[2])
  }

  return UNTIMED
}
