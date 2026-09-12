/**
 * The research subagent's tool set: three read-only notebook tools over
 * the running service. No creation, no approvals, and no discovery of
 * other chat tools — the set is closed, so a research run can never
 * recurse or write.
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
import { exists, readTextFile, walkToArray } from '#shared/fs/mod.ts'
import ContextAssembler from '#shared/models/AI/ContextAssembler/mod.ts'
import { createRecencyTypeScorer } from '#shared/models/AI/ContextAssembler/scorers.ts'
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
import { documentPage, fitDocumentPages, type DocumentPage } from './documents.ts'

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
  /** Injected store for an isolated notebook; production builds it lazily. */
  loadStore?: () => Promise<MarkdownStore>
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
  const { tasks, baseDir, today, trace, contextTokens } = opts
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

        const docs: Array<{ doc: Document; path: string }> = []
        const originals = new Map<string, string>()
        for (const p of paths.slice(0, QUERY_READ_CAP)) {
          try {
            const markdown = await readTextFile(p)
            originals.set(p, markdown)
            docs.push({ doc: Document.fromMarkdown(markdown), path: p })
          } catch {
            // Skip unreadable files
          }
        }
        const collection = DomainCollection.fromDocuments(docs, await getStore(), { depth: 1 })
        const assembler = ContextAssembler.from(collection, {
          scorer: createRecencyTypeScorer(today),
          maxTokens: Math.min(QUERY_RESULT_MAX_TOKENS, contextTokens),
        })
        const metadata = {
          matched: paths.length,
          rendered: 0,
          truncated: truncations.length > 0 ? truncations : undefined,
        }
        // ContextAssembler's budget is deliberately soft: one oversized doc is
        // still admitted. Cap the actual payload here, with recoverable pages.
        const pages: DocumentPage[] = []
        for (const { item } of assembler.kept) {
          try {
            // Linked documents also need original file offsets, not a store's reserialization.
            const markdown = originals.get(item.path) ?? (await readTextFile(item.path))
            pages.push(documentPage(path.relative(baseDir, item.path), markdown))
          } catch {
            // A linked document may have been removed since the store was built.
          }
        }
        const documents = fitDocumentPages(pages, maxChars - JSON.stringify(metadata).length - 32)
        for (const doc of documents) trace.sources.add(doc.path)
        return { ...metadata, rendered: documents.length, documents }
      },
    },

    notebook_read: {
      description:
        'Read a page of a notebook document by its path. Continue at nextOffset to read more, or use find to jump to literal text in a long document. Offsets count characters from the start of the original file.',
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
        try {
          const markdown = await readTextFile(abs)
          if (find) {
            const search = new RegExp(RegExp.escape(find), 'giu')
            search.lastIndex = offset
            const at = search.exec(markdown)?.index
            if (at === undefined)
              return {
                path: path.relative(baseDir, abs),
                found: false,
                note: 'Text not found at or after this offset.',
              }
            offset = Math.max(offset, at - 1000)
          }
          const [page] = fitDocumentPages([documentPage(path.relative(baseDir, abs), markdown, offset)], maxChars - 2)
          if (!page) return { success: false, error: 'The reading budget is too small for this document excerpt.' }
          record(abs)
          return page
        } catch {
          return { success: false, error: `No document at ${requested}.` }
        }
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
        const pages: DocumentPage[] = []
        for (const file of matched) {
          try {
            pages.push(documentPage(path.relative(baseDir, file), await readTextFile(file)))
          } catch {
            // Skip unreadable files
          }
        }
        const matches = fitDocumentPages(pages, maxChars - 16)
        for (const match of matches) trace.sources.add(match.path)
        return { matches }
      },
    },
  }
}
