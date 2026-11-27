/**
 * search_notebook: a notebook lookup in well under a second, for voice. A text chat turn runs the
 * chat's retrieval before every message; a spoken one does not, so without this the backend's only
 * notebook search was ai_research, which takes tens of seconds. It asks the service's own search
 * index (the one the search page uses) and answers with paths a narrow read_file can open.
 */
import path from 'node:path'
import type { FunctionTool } from 'openai/resources/live/live'
import { SEARCH_KINDS, type SearchResponse, type SearchResult } from '../search/types.ts'
import type { VoiceTool } from './mod.ts'

export const SEARCH_NOTEBOOK_TOOL = 'search_notebook'
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 20

export interface NotebookSearchOptions {
  port: number
  /** The notebook folder the search's relative paths start from */
  notebookDir: string
  fetcher?: (input: string, init: RequestInit) => Promise<Response>
}

const DEFINITION: FunctionTool = {
  type: 'function',
  name: SEARCH_NOTEBOOK_TOOL,
  description:
    "Search the notebook in under a second: people, organizations, projects, meetings, messages, journals, notes, decisions, ideas, goals and days, by words in their names, titles, tags and text. Returns each match's full path, kind, date, title and a short snippet. Use it before ai_research. Filter with kind; set newest for the latest or most recent records (with an empty query, newest lists the latest records of that kind). A query that is a date, such as 2026-11-22 or yesterday, finds that day's records. Open a result narrowly with read_file and find.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Words to look for, or a date; may be empty when kind and newest are given',
      },
      kind: { type: 'string', enum: [...SEARCH_KINDS], description: 'Only records of this kind' },
      newest: { type: 'boolean', description: 'Newest first, instead of best match first' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        description: `How many results to return (default ${DEFAULT_LIMIT})`,
      },
    },
  },
  strict: false,
}

function line(result: SearchResult, index: number, notebookDir: string): string {
  const head = [result.kind, result.date, result.title].filter(Boolean).join(' · ')
  const facts = result.properties
    .slice(0, 3)
    .map((property) => `${property.label}: ${property.value}`)
    .join('; ')
  return [
    `${index + 1}. ${head}`,
    result.relativePath ? `   path: ${path.join(notebookDir, result.relativePath)}` : '',
    result.subtitle ? `   ${result.subtitle}` : '',
    facts ? `   ${facts}` : '',
    result.snippet ? `   snippet: ${result.snippet.replace(/\s+/g, ' ').trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The search's answer as plain text: what was asked, how many matched, then each result. A date query also
 * names the day's record and a few other records from that day, of any kind; they are shown only when the
 * numbered results do not already hold them, and never as the day's list items (day_items reads those).
 */
export function formatSearch(response: SearchResponse, notebookDir: string, asked: string): string {
  const results = response.results
  const listed = new Set(results.map((result) => result.relativePath))
  const heading = `${response.total} ${response.total === 1 ? 'match' : 'matches'} for ${asked} (showing ${results.length}). Today is ${response.today}.`
  const day =
    response.day?.relativePath && !listed.has(response.day.relativePath)
      ? [`Day record: ${path.join(notebookDir, response.day.relativePath)}`]
      : []
  const others = response.dayItems
    .filter((item) => !listed.has(item.relativePath))
    .slice(0, 5)
    .map(
      (item) =>
        `- ${[item.kind, item.title].filter(Boolean).join(' · ')}${item.relativePath ? ` (path: ${path.join(notebookDir, item.relativePath)})` : ''}`,
    )
  return [
    heading,
    ...day,
    ...(others.length ? ['Other records dated that day:', ...others] : []),
    ...results.map((result, i) => line(result, i, notebookDir)),
  ].join('\n')
}

export function notebookSearchTool(options: NotebookSearchOptions): VoiceTool {
  const fetcher = options.fetcher ?? fetch
  return {
    definition: DEFINITION,
    run: async (input, signal) => {
      const query = typeof input.query === 'string' ? input.query.trim().slice(0, 500) : ''
      const given = typeof input.kind === 'string' ? input.kind.trim() : ''
      // An unknown kind would silently search everything; say so, so the next call can use a real one.
      if (given && !(SEARCH_KINDS as readonly string[]).includes(given))
        return `There is no "${given}" kind. Use one of: ${SEARCH_KINDS.join(', ')}; or leave kind out.`
      const kind = given || undefined
      const requested =
        typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.trunc(input.limit) : DEFAULT_LIMIT
      const limit = Math.max(1, Math.min(MAX_LIMIT, requested))
      if (!query && !kind) return 'Give a query, or a kind with newest, to search the notebook.'
      const params = new URLSearchParams({ q: query, limit: String(limit) })
      if (kind) params.set('kind', kind)
      if (input.newest === true) params.set('sort', 'newest')
      const timeout = AbortSignal.timeout(10_000)
      const response = await fetcher(`http://localhost:${options.port}/search/_api?${params}`, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      if (!response.ok) {
        const message = ((await response.json().catch(() => null)) as { message?: string } | null)?.message?.trim()
        const reason = message ? `: ${/[.!?]$/.test(message) ? message : `${message}.`}` : '.'
        return `The notebook search could not answer (${response.status})${reason} If it keeps failing, use ai_research.`
      }
      const asked = [
        query ? JSON.stringify(query) : 'everything',
        kind ? `in ${kind} records` : '',
        input.newest === true ? 'newest first' : '',
      ]
        .filter(Boolean)
        .join(' ')
      return formatSearch((await response.json()) as SearchResponse, options.notebookDir, asked)
    },
  }
}
