/**
 * The research subagent's tool set: three read-only notebook tools over
 * the running service. No creation, no approvals, and no discovery of
 * other chat tools — the set is closed, so a research run can never
 * recurse or write.
 *
 * Document text comes from the service's page endpoint, never from the
 * files: the service strips the machine comments (a saved chat's context
 * log is most of its bytes) and defines the offsets, so research reads the
 * same characters the chat does. The person lookup lists filenames locally
 * and pages their text through the same endpoint.
 *
 * The sub-model is its own repair loop: an invalid query comes back as
 * the validator's errors in the tool result, and the model fixes and
 * retries within its step budget — there is no nested repair model call.
 * ContextAssembler ranks query results; bounded document pages enforce
 * their serialized size before they reach the sub-model. The query layer
 * deliberately never caps a date-bounded match set; the embedder owns the budget.
 */

import * as path from 'node:path'
import { jsonSchema } from 'ai'
import type CommandService from '#commands/lib/core/CommandService.ts'
import { DIR_PEOPLE, DIR_PEOPLE_OLD } from '#shared/config.ts'
import { exists, walkToArray } from '#shared/fs/mod.ts'
import ContextAssembler from '#shared/models/AI/ContextAssembler/mod.ts'
import { type DocumentPageFetcher, fetchDocumentPages } from '#shared/models/AI/DocumentPages/client.ts'
import { type DocumentPage, isDocumentPage } from '#shared/models/AI/DocumentPages/mod.ts'
import {
  createChatScorer,
  type DocProvenance,
  extractTopicTerms,
  tierForResultSize,
} from '#shared/models/Chat/ChatContext/score.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import {
  expandMissingSubfields,
  graphQLValidationErrors,
  normalizeGraphQLQuery,
} from '#shared/models/DomainCollection/query/normalize.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { fitDocumentPages } from './documents.ts'

/** Budget for one query result's embedded markdown. */
const QUERY_RESULT_MAX_TOKENS = 30_000
/** Documents read per query before budgeting — the assembler prunes further. */
const QUERY_READ_CAP = 120
/** Person files returned per lookup. */
const PERSON_MATCH_CAP = 3

/** Paths the run actually surfaced to the sub-model — the report's source list. */
export interface ResearchTrace {
  sources: Set<string>
}

export interface ResearchToolsOptions {
  tasks: CommandService
  baseDir: string
  today: PlainDate
  trace: ResearchTrace
  contextTokens: number
  /** The research question — its words rank a capped result the way the chat ranks its context. */
  question?: string
  /** Injected store for an isolated notebook; production builds it lazily. */
  loadStore?: () => Promise<MarkdownStore>
  /** Pages of document text; production asks the running service. */
  fetchPages?: DocumentPageFetcher
}

/** Lowercased, separator-free form both sides of a person match reduce to. */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Person-file candidates for a name, best first: an exact stem match
 * outranks a stem containing every token of the name. Pure — exported for
 * tests.
 */
export function matchPersonFiles(files: string[], name: string): string[] {
  const wanted = normalizeForMatch(name)
  if (!wanted) return []
  const tokens = wanted.split(' ')
  const exact: string[] = []
  const partial: string[] = []
  for (const file of files) {
    const stem = normalizeForMatch(path.basename(file, '.md'))
    if (stem === wanted) exact.push(file)
    else if (tokens.every((t) => stem.includes(t))) partial.push(file)
  }
  return [...exact, ...partial]
}

/**
 * Normalize and validate a model-written query. Returns the query ready to
 * execute, or the validator's errors for the model to repair. Exported for
 * tests.
 */
export async function prepareQuery(graphql: string): Promise<{ query: string; errors: string[] | null }> {
  const query = await expandMissingSubfields(normalizeGraphQLQuery(graphql))
  const errors = await graphQLValidationErrors(query)
  return { query, errors: errors ?? null }
}

export function createResearchTools(opts: ResearchToolsOptions) {
  const { tasks, baseDir, today, trace, contextTokens, question } = opts
  const fetchPages = opts.fetchPages ?? ((requests) => fetchDocumentPages(requests, 'ai:research'))
  const maxChars = Math.floor(Math.min(QUERY_RESULT_MAX_TOKENS, contextTokens) * 4)
  const closed = { success: false, error: 'The parent chat has disabled notebook reading.' }

  // One store per run, built lazily on the first query that returns
  // documents — lookups and reads never pay for it.
  let storePromise: Promise<MarkdownStore> | null = null
  const getStore = () => (storePromise ??= (opts.loadStore ?? (() => MarkdownStore.buildFromAll()))())

  const record = (absPath: string): string => {
    const rel = path.relative(baseDir, absPath)
    trace.sources.add(rel)
    return rel
  }

  const insideNotebook = (candidate: string): string | null => {
    const abs = path.resolve(baseDir, candidate)
    return abs.startsWith(baseDir + path.sep) || abs === baseDir ? abs : null
  }

  return {
    notebook_query: {
      description:
        'Run a GraphQL query against the notebook. Returns matching documents as markdown, plus match/return counts. If the result reports validation errors, fix the query and retry. If matched exceeds returned, the result was capped — tighten the date bounds or the filters instead of concluding absence.',
      inputSchema: jsonSchema<{ graphql: string }>({
        type: 'object',
        properties: {
          graphql: { type: 'string', description: 'The GraphQL query, following the schema in your instructions' },
        },
        required: ['graphql'],
      }),
      execute: async ({ graphql }: { graphql: string }) => {
        if (contextTokens <= 0) return closed
        const { query, errors } = await prepareQuery(graphql)
        if (errors) return { valid: false, errors }

        const result = await tasks.run('markdown:sel', { graphql: query, raw: true, server: 'true' })
        if (result.status !== 'success') {
          return { success: false, error: truncate(result.message ?? 'Query execution failed', 500) }
        }
        const paths: string[] = result.data?.paths ?? []
        const truncations = (result.data?.truncations ?? []).map(
          (t: { field: string; matched: number; returned: number }) => ({
            field: t.field,
            matched: t.matched,
            returned: t.returned,
          }),
        )
        if (paths.length === 0) {
          return {
            matched: 0,
            markdown: '',
            note: 'No documents matched. Consider different vocabulary, a wider date window, or another root field.',
          }
        }

        // The first page of each document, from the service: it is the text
        // the sub-model may read, so it is also the text that gets scored.
        const docs: Array<{ doc: Document; path: string }> = []
        const pageByPath = new Map<string, DocumentPage>()
        const firstPages = await fetchPages(paths.slice(0, QUERY_READ_CAP).map((p) => ({ path: p })))
        for (const page of firstPages) {
          if (!isDocumentPage(page)) continue
          const abs = path.resolve(baseDir, page.path)
          try {
            pageByPath.set(abs, page)
            docs.push({ doc: Document.fromMarkdown(page.markdown), path: abs })
          } catch {
            // Skip a page that does not parse as a document
          }
        }
        const collection = DomainCollection.fromDocuments(docs, await getStore(), { depth: 1 })
        // A capped result keeps what matches the question, not what is newest:
        // the chat's scorer, with the query's own selectivity as provenance.
        const provenance = new Map<string, DocProvenance>(
          docs.map((d) => [d.path, { tier: tierForResultSize(paths.length), hits: 1, lastHitTurn: 1 }]),
        )
        const { scorer } = createChatScorer({
          today,
          collection,
          terms: extractTopicTerms(question, [query]),
          provenance,
          turn: 1,
        })
        const assembler = ContextAssembler.from(collection, {
          scorer,
          maxTokens: Math.min(QUERY_RESULT_MAX_TOKENS, contextTokens),
        })
        const metadata = {
          matched: paths.length,
          rendered: 0,
          truncated: truncations.length > 0 ? truncations : undefined,
        }
        // ContextAssembler's budget is deliberately soft: one oversized doc is
        // still admitted. Cap the actual payload here, with recoverable pages.
        // Linked documents the store added are paged through the service too.
        const linked = assembler.kept.map(({ item }) => item.path).filter((p) => !pageByPath.has(p))
        for (const page of linked.length > 0 ? await fetchPages(linked.map((p) => ({ path: p }))) : []) {
          if (isDocumentPage(page)) pageByPath.set(path.resolve(baseDir, page.path), page)
        }
        const pages: DocumentPage[] = []
        for (const { item } of assembler.kept) {
          const page = pageByPath.get(item.path)
          if (page) pages.push(page)
        }
        const documents = fitDocumentPages(pages, maxChars - JSON.stringify(metadata).length - 32)
        for (const doc of documents) trace.sources.add(doc.path)
        return { ...metadata, rendered: documents.length, documents }
      },
    },

    notebook_read: {
      description:
        'Read a page of a notebook document by its path. Continue at nextOffset to read more, or use find to jump to literal text in a long document. Offsets count characters from the start of the document as research reads it.',
      inputSchema: jsonSchema<{ path: string; offset?: number; find?: string }>({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Notebook-relative document path, e.g. "projects/atlas.md"' },
          offset: {
            type: 'integer',
            minimum: 0,
            description: 'Start here, or search for find from here; defaults to 0',
          },
          find: { type: 'string', description: 'Optional literal text to locate, ignoring case' },
        },
        required: ['path'],
      }),
      execute: async ({ path: requested, offset = 0, find }: { path: string; offset?: number; find?: string }) => {
        if (contextTokens <= 0) return closed
        const abs = insideNotebook(requested)
        if (!abs) return { success: false, error: 'Path is outside the notebook.' }
        const [result] = await fetchPages([{ path: abs, offset, ...(find ? { find } : {}) }])
        if (!result || 'error' in result)
          return { success: false, error: result?.error ?? `No document at ${requested}.` }
        if (!isDocumentPage(result)) return { path: result.path, found: false, note: result.note }
        const [page] = fitDocumentPages([result], maxChars - 2)
        if (!page) return { success: false, error: 'The reading budget is too small for this document excerpt.' }
        record(abs)
        return page
      },
    },

    person_lookup: {
      description:
        'Find a person\'s profile document by name (exact or partial, e.g. "Jane" or "Jane Doe"). Returns the best-matching person files. For their recent activity, follow up with notebook_query using involves or from/to filters.',
      inputSchema: jsonSchema<{ name: string }>({
        type: 'object',
        properties: {
          name: { type: 'string', description: "The person's name as referenced" },
        },
        required: ['name'],
      }),
      execute: async ({ name }: { name: string }) => {
        if (contextTokens <= 0) return closed
        const roots: string[] = []
        for (const root of [DIR_PEOPLE, DIR_PEOPLE_OLD]) {
          if (await exists(root)) roots.push(root)
        }
        const entries = roots.length > 0 ? await walkToArray(roots) : []
        const files = entries.map((e) => e.path).filter((p) => p.endsWith('.md'))
        const matched = matchPersonFiles(files, name).slice(0, PERSON_MATCH_CAP)
        if (matched.length === 0) {
          return {
            matches: [],
            note: `No person file matched "${name}". Try notebook_query with involves/from/to filters or bodyContains.`,
          }
        }
        const pages = (await fetchPages(matched.map((file) => ({ path: file })))).filter(isDocumentPage)
        const matches = fitDocumentPages(pages, maxChars - 16)
        for (const match of matches) trace.sources.add(match.path)
        return { matches }
      },
    },
  }
}
