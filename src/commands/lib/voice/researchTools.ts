import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { describeNotebookPath } from './notebookAgent.ts'

export type ResearchFetch = (url: string, init?: RequestInit) => Promise<Response>
export interface ResearchTrace {
  paths: Set<string>
  searches: number
  failures: number
  bytes: number
  calls: number
}
export interface ResearchToolOptions {
  baseDir: string
  port: number
  signal: AbortSignal
  trace: ResearchTrace
  fetcher?: ResearchFetch
  maxCalls: number
  maxBytes: number
  chunkBytes: number
}

const queryFields = {
  type: z
    .string()
    .max(50)
    .optional()
    .describe(
      'Document type, such as meeting, message, person, project, decision, goal, day, journal, chat, or memory.',
    ),
  bodyContains: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('One literal substring, not a natural-language question.'),
  involves: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('A person, organization, or project named in document relationships.'),
  dateGte: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateLte: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  pathContains: z.string().min(1).max(200).optional(),
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function relativePath(base: string, requested: string): string | null {
  if (path.isAbsolute(requested) || requested.includes('\0')) return null
  const relative = path.relative(base, path.resolve(base, requested))
  return relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    path.extname(relative).toLowerCase() === '.md'
    ? relative
    : null
}

/** Leave a partial final UTF-8 code point for the next byte-offset read. */
function completeUtf8Prefix(buffer: Uint8Array, length: number): number {
  let start = length - 1
  while (start >= 0 && (buffer[start] & 0xc0) === 0x80) start--
  if (start < 0) return length
  const head = buffer[start]
  const width =
    head >= 0xc2 && head <= 0xdf ? 2 : head >= 0xe0 && head <= 0xef ? 3 : head >= 0xf0 && head <= 0xf4 ? 4 : 1
  return length - start < width ? start : length
}

/** Closed, deterministic tools. No model-written GraphQL or arbitrary file access. */
export function createVoiceResearchTools(options: ResearchToolOptions) {
  const { signal, trace } = options
  const base = path.resolve(options.baseDir)
  const fetcher = options.fetcher ?? fetch
  let indexReady = false
  const request = async (route: string, init?: RequestInit): Promise<Record<string, unknown>> => {
    const response = await fetcher(`http://localhost:${options.port}${route}`, {
      ...init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    })
    if (!response.ok) throw new Error('Notebook service unavailable')
    const payload: unknown = await response.json()
    if (!object(payload)) throw new Error('Invalid notebook response')
    return payload
  }
  const run = async <T>(fn: () => Promise<T>) => {
    signal.throwIfAborted()
    if (++trace.calls > options.maxCalls)
      return { ok: false, error: 'Tool budget exhausted; report the evidence and limits already found.' }
    try {
      return await fn()
    } catch {
      signal.throwIfAborted()
      trace.failures++
      return {
        ok: false,
        error: 'Notebook source unavailable or unreadable. This is a lookup failure, not an empty result.',
      }
    }
  }
  const search = async (query: string) => {
    const payload = await request(`/docs/_api/search?q=${encodeURIComponent(query)}&limit=12`)
    if (!Array.isArray(payload.results)) throw new Error('Invalid search response')
    indexReady = true
    trace.searches++
    const results = payload.results.slice(0, 12).flatMap((item) => {
      if (
        !object(item) ||
        typeof item.relativePath !== 'string' ||
        typeof item.title !== 'string' ||
        typeof item.kind !== 'string'
      )
        throw new Error('Invalid search entry')
      const file = relativePath(base, item.relativePath)
      if (!file) return []
      return [
        {
          path: file,
          title: item.title.slice(0, 200),
          kind: item.kind.slice(0, 50),
          date: typeof item.date === 'string' ? item.date.slice(0, 10) : undefined,
          snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, 400) : undefined,
        },
      ]
    })
    return {
      ok: true,
      results,
      limited: payload.results.length >= 12,
      note: 'Ranked keyword matches, at most 12. Read promising files for evidence. No matches does not establish absence.',
    }
  }

  return {
    search_notebook: tool({
      description:
        'Search the notebook index by a few distinctive words. Every word must match. Use names, aliases, or topic terms, then read promising files. Broaden or change words if nothing matches.',
      inputSchema: z.object({ query: z.string().trim().min(1).max(200) }),
      execute: ({ query }) => run(() => search(query)),
    }),
    query_notebook: tool({
      description:
        'Find notebook paths by document type, inclusive YYYY-MM-DD date bounds, relationships, path, or one body substring. Filters combine with AND. Returns at most 20 paths; narrow capped results. Dates are record dates, not necessarily event dates. Read files to establish facts.',
      inputSchema: z.object(queryFields),
      execute: (filters) =>
        run(async () => {
          // GraphQL's legacy resolver returns [] before indexing; check readiness
          // through the search route, which correctly returns HTTP 503 then.
          if (!indexReady) await search('')
          const where = Object.entries(filters)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join(', ')
          const payload = await request('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `{ documents(where: {${where}}, limit: 20) {path type} }` }),
          })
          if (payload.errors !== undefined && (!Array.isArray(payload.errors) || payload.errors.length > 0))
            throw new Error('Notebook query failed')
          if (!object(payload.data) || !Array.isArray(payload.data.documents)) throw new Error('Invalid query response')
          trace.searches++
          const results = payload.data.documents.slice(0, 20).flatMap((item) => {
            if (!object(item) || typeof item.path !== 'string' || typeof item.type !== 'string')
              throw new Error('Invalid query entry')
            // DomainCollection keeps absolute store paths; normalize them at this
            // trusted service boundary. The model's read_file still requires relative paths.
            const file = relativePath(base, path.isAbsolute(item.path) ? path.relative(base, item.path) : item.path)
            return file ? [{ path: file, kind: item.type.slice(0, 50), source: describeNotebookPath(file) }] : []
          })
          return {
            ok: true,
            results,
            limited: payload.data.documents.length >= 20,
            note: 'At most 20 documents; a capped or empty query is not a complete notebook inventory.',
          }
        }),
    }),
    read_file: tool({
      description:
        'Read a bounded excerpt of a notebook markdown file. Use only notebook-relative paths. offsetBytes defaults to zero; use nextOffsetBytes to continue a truncated file. Preserve source dates and distinguish plans from completed events.',
      inputSchema: z.object({
        path: z.string().min(1).max(1000),
        offsetBytes: z.number().int().min(0).max(100_000_000).optional(),
      }),
      execute: ({ path: requested, offsetBytes = 0 }) =>
        run(async () => {
          const relative = relativePath(base, requested)
          if (!relative)
            return { ok: false, error: 'Only notebook-relative markdown paths inside the notebook are allowed.' }
          const [realBase, realFile] = await Promise.all([realpath(base), realpath(path.resolve(base, relative))])
          if (!relativePath(realBase, path.relative(realBase, realFile)))
            return { ok: false, error: 'The file resolves outside the notebook.' }
          const allowance = Math.min(options.chunkBytes, options.maxBytes - trace.bytes)
          if (allowance <= 0)
            return { ok: false, error: 'Document reading budget exhausted; report the available evidence and limits.' }
          // Reserve before awaiting so parallel tool calls cannot exceed the run budget.
          trace.bytes += allowance
          let bytesRead = 0
          let file: Awaited<ReturnType<typeof open>> | undefined
          try {
            file = await open(realFile, constants.O_RDONLY | constants.O_NOFOLLOW)
            const info = await file.stat()
            if (!info.isFile()) throw new Error('Not a file')
            const buffer = Buffer.alloc(allowance)
            bytesRead = (await file.read(buffer, 0, allowance, offsetBytes)).bytesRead
            signal.throwIfAborted()
            const end = offsetBytes + bytesRead < info.size ? completeUtf8Prefix(buffer, bytesRead) : bytesRead
            if (bytesRead > 0 && end === 0)
              return { ok: false, error: 'The remaining read budget cannot fit the next complete UTF-8 character.' }
            if (end > 0) trace.paths.add(relative)
            const truncated = offsetBytes + end < info.size
            return {
              ok: true,
              path: relative,
              source: describeNotebookPath(relative),
              offsetBytes,
              markdown: buffer.subarray(0, end).toString('utf8'),
              truncated,
              nextOffsetBytes: truncated ? offsetBytes + end : undefined,
            }
          } finally {
            trace.bytes -= allowance - bytesRead
            await file?.close()
          }
        }),
    }),
  }
}
