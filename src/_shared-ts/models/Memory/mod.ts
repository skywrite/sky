/**
 * The AI-maintained memory store — ai/memory/ in the notebook.
 *
 * A memory is one markdown file holding one distilled fact the AI carries
 * across chat sessions: how to answer (preference), what the user's
 * shorthand means (glossary), an informal open loop (thread), an
 * uncaptured stable fact (observation), or retrieval meta-knowledge
 * (lesson). The notebook proper remains the long-term record and always
 * wins on conflict — a memory is the residue no capture flow (decisions,
 * ideas, notes) would take, never a substitute for one.
 *
 * Read side (this module): memories load straight from disk — the dir is
 * a handful of small files, and prompt assembly must not depend on the
 * service being up. Preference memories render into a standing
 * system-prompt block frozen at session start; every memory ALSO rides
 * the chat context universe as a normal scored document (entity type
 * 'memory', fetched via the service like goals), where the s4 scorer
 * surfaces on-topic ones and sheds the rest. Write side (the save-time
 * distiller that creates/updates/expires memories) is a later rung —
 * today the store is hand-maintained.
 */

import { readTextFile, walk } from '#shared/fs/mod.ts'
import { estimateTokens } from '#shared/models/AI/ContextAssembler/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'

export const MEMORY_KINDS = ['preference', 'glossary', 'thread', 'observation', 'lesson'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

/** Path fragment identifying memory files — mirrors entityTypes' detection. */
export const MEMORY_PATH_SEGMENT = '/ai/memory/'

export const MEMORY_BLOCK = {
  /**
   * Token ceiling of the standing preference block. The block rides the
   * system prompt of every chat turn, so it must stay a note card, not a
   * second context: freshest preferences first, and the cap cuts the tail.
   */
  maxTokens: 2000,
} as const

export interface MemoryEntry {
  /** Absolute file path */
  path: string
  /** Filename without extension — the memory's stable handle */
  slug: string
  /** Declared kind; undefined when the frontmatter kind is missing or unknown */
  kind?: MemoryKind
  /** One-line gist: frontmatter summary, else the first body line */
  summary: string
  /** Body markdown, frontmatter stripped */
  body: string
  /** Freshest of lastConfirmed/updated/created (YYYY-MM-DD), for ordering */
  freshness?: string
  /** Hand-set guard: the distiller and consolidator must never rewrite or delete this file */
  locked?: boolean
}

/** YAML dates may parse as Date objects or strings — normalize to YYYY-MM-DD. */
export function yamlDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' && value.length > 0) return value.slice(0, 10)
  return undefined
}

function toEntry(filePath: string, doc: Document): MemoryEntry {
  const rawKind = String(doc.yaml['kind'] ?? '')
  const kind = (MEMORY_KINDS as readonly string[]).includes(rawKind) ? (rawKind as MemoryKind) : undefined
  const body = doc.toMarkdown({ yaml: false }).trim()
  const summary = String(doc.yaml['summary'] ?? '').trim() || body.split('\n', 1)[0]
  const slug = filePath.slice(filePath.lastIndexOf('/') + 1).replace(/\.md$/, '')
  const freshness =
    yamlDate(doc.yaml['lastConfirmed']) ?? yamlDate(doc.yaml['updated']) ?? yamlDate(doc.yaml['created'])
  return {
    path: filePath,
    slug,
    kind,
    summary,
    body,
    ...(freshness ? { freshness } : {}),
    ...(doc.yaml['locked'] === true ? { locked: true } : {}),
  }
}

/**
 * Load every memory in the dir, freshest first (undated last, slug
 * tiebreak). A missing dir is an empty store — the feature predates the
 * first memory on any given machine. An unreadable file is skipped with a
 * warning: one corrupt memory must not cost the session the rest.
 */
export async function loadMemories(memoryDir: string): Promise<MemoryEntry[]> {
  const entries: MemoryEntry[] = []
  for await (const file of walk(memoryDir, { includeDirs: false, exts: ['.md'] })) {
    try {
      entries.push(toEntry(file.path, Document.fromMarkdown(await readTextFile(file.path))))
    } catch (err) {
      console.warn(`[memory] skipping unreadable memory ${file.path}: ${(err as Error).message}`)
    }
  }
  entries.sort((a, b) => {
    if (a.freshness !== b.freshness) return (b.freshness ?? '') < (a.freshness ?? '') ? -1 : 1
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0
  })
  return entries
}

/**
 * The standing system-prompt block: preference memories only, one bullet
 * each, freshest first up to the token cap. Empty string when there are
 * none — hosts wrap the block in a conditional prompt section. Rendered
 * once at session start and never mid-session: the system prompt must stay
 * byte-identical across turns to keep its prompt-cache breakpoint.
 */
export function renderPreferenceBlock(memories: MemoryEntry[]): string {
  const lines: string[] = []
  let tokens = 0
  for (const m of memories) {
    if (m.kind !== 'preference') continue
    const text = m.body.replace(/\s*\n\s*/g, ' ').trim()
    if (!text) continue
    const line = `- ${text}`
    const cost = estimateTokens(line)
    if (tokens + cost > MEMORY_BLOCK.maxTokens) break
    tokens += cost
    lines.push(line)
  }
  return lines.join('\n')
}
