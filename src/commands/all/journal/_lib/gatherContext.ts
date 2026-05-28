/**
 * Context rules for journal:new --ai question generation:
 *
 * QUERIED (last 14 days):
 *   - journals, meetings, days, documents (includes AI chats, summaries)
 *   - health tracking CSVs (sleep, weight, strength, distance, work)
 *
 * ALWAYS INCLUDED:
 *   - pending decisions, goals
 *   - people referenced by queried docs (depth 1)
 *   - projects referenced by queried docs (depth 1)
 *
 * SUMMARY GATE (per day):
 *   - If a day has summary.md → keep only: summary, journals, AI chats
 *   - If no summary → keep all files for that day
 *
 * SCORING (via ContextAssembler):
 *   - Goals/decisions (12) > journals (8) > day activity (5) > entities (3)
 *   - Recency decays linearly over 14 days (not 180)
 *   - Orgs always pruned
 *   - Token budget: 120k
 *
 * EXCLUDED:
 *   - orgs (pruned by scorer)
 *   - transcript sections (stripped from all documents)
 */

import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { executeQuery } from '#shared/models/DomainCollection/query/execute.ts'
import ContextAssembler from '#shared/models/AI/ContextAssembler/mod.ts'
import { createJournalScorer } from '#shared/models/AI/ContextAssembler/scorers.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { DIR_BASE, DIR_TIME } from '#config'
import { gatherHealthData } from '../../summary/_health.ts'

/** Token budget for journal context assembly.
 * Must leave headroom for prompt template, AboutMe fields, structured-output
 * system prompt, and JSON schema. Sized for 1M context window models. */
const MAX_TOKENS = 300_000

export interface JournalContext {
  /** Assembled markdown from DomainCollection */
  contextMarkdown: string
  /** Absolute paths of all documents included in the context */
  paths: string[]
  today: {
    date: string
    dayOfWeek: string
    /** HH:MM time string (may have extended hours like "25:30") */
    time?: string
    /** "morning", "afternoon", or "evening" */
    timeOfDay?: string
  }
  documentCount: number
  /** Number of documents pruned by the context assembler to fit the token budget. */
  prunedCount: number
  /** Estimated tokens of kept documents. */
  totalTokens: number
}

const CONTEXT_QUERY = `{
  journals(where: { recent: "14d" }) { path }
  meetings(where: { recent: "14d" }) { path }
  days(where: { recent: "14d" }) { path }
  documents(where: { recent: "14d" }) { path }
  decisions(where: { pending: true }) { path }
  goals { path }
}`

function getTimeOfDay(time: string): string {
  const hour = parseInt(time.split(':')[0], 10)
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

export async function gatherContext(today: PlainDate, time?: string): Promise<JournalContext> {
  const store = await MarkdownStore.buildFromAll()

  // Query all relevant document types
  const result = await executeQuery<Record<string, Array<{ path: string }>>>(CONTEXT_QUERY, store)
  const allPaths = new Set<string>()
  if (result.data) {
    for (const entries of Object.values(result.data)) {
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry.path) allPaths.add(entry.path)
        }
      }
    }
  }

  // Detect day dirs that have summaries from the queried paths
  const summarizedDays = new Set<string>()
  for (const filePath of allPaths) {
    if (filePath.endsWith('/summary.md') && filePath.includes('/time/')) {
      summarizedDays.add(path.dirname(filePath))
    }
  }

  // Filter out redundant files for days that have summaries
  const filteredPaths = new Set<string>()
  for (const filePath of allPaths) {
    const summarizedDay = [...summarizedDays].find((dir) => filePath.startsWith(dir + '/'))
    if (summarizedDay) {
      // Day has a summary — only keep journals, AI chats, and the summary itself
      const rel = filePath.slice(summarizedDay.length + 1)
      if (rel.startsWith('journal/') || rel.startsWith('actions/ai-chats/') || rel === 'summary.md') {
        filteredPaths.add(filePath)
      }
    } else {
      filteredPaths.add(filePath)
    }
  }

  // Read and parse all documents
  const docs: Array<{ doc: Document; path: string }> = []
  for (const filePath of filteredPaths) {
    try {
      const content = await readTextFile(filePath)
      const doc = Document.fromMarkdown(content)
        .stripHtmlComments()
        .filterSections((h) => !h.text.toLowerCase().includes('transcript'))
      docs.push({ doc, path: filePath })
    } catch {
      /* skip unreadable files */
    }
  }

  const collection = DomainCollection.fromDocuments(docs, store, { depth: 1 })

  // Score and budget — the journal scorer handles org pruning via -Infinity
  const assembler = ContextAssembler.from(collection, {
    scorer: createJournalScorer(today),
    maxTokens: MAX_TOKENS,
  })

  let contextMarkdown = assembler.toMarkdown({ relativeTo: DIR_BASE, delimited: true })

  // Gather health tracking data (last 5 days — health data is small, no need
  // to expand to 14d like the document query window)
  const healthSection = await gatherHealthSection(today, 5)
  if (healthSection) {
    contextMarkdown += '\n\n' + healthSection
  }

  return {
    contextMarkdown,
    paths: assembler.kept.map((s) => s.item.path),
    today: {
      date: today.ymd,
      dayOfWeek: today.dayLong,
      ...(time ? { time, timeOfDay: getTimeOfDay(time) } : {}),
    },
    documentCount: assembler.size,
    prunedCount: assembler.pruned.length,
    totalTokens: assembler.totalTokens,
  }
}

async function gatherHealthSection(today: PlainDate, days: number): Promise<string | null> {
  const lines: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = today.addDays(-i)
    const data = await gatherHealthData(day, DIR_TIME)
    const parts: string[] = []
    if (data.sleep) parts.push(`Sleep: ${data.sleep.range} (${data.sleep.duration} hrs)`)
    if (data.weight) parts.push(`Weight: ${data.weight} lbs`)
    if (data.strength) {
      const sessions = data.strength.map((s) => `${s.lbs} lbs${s.duration ? `, ${s.duration} mins` : ''}`).join('; ')
      parts.push(`Strength: ${sessions}`)
    }
    if (data.distance) {
      const sessions = data.distance.map((s) => `${s.miles} mi${s.duration ? `, ${s.duration} mins` : ''}`).join('; ')
      parts.push(`Distance: ${sessions}`)
    }
    if (data.work) parts.push(`Work: ${data.work.duration} hrs`)
    if (parts.length > 0) lines.push(`- **${day.ymd}**: ${parts.join(' | ')}`)
  }
  if (lines.length === 0) return null
  return `## Health Tracking\n\n${lines.join('\n')}`
}
