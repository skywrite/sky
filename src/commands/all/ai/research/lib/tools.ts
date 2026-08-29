/**
 * The research subagent's tool set: three read-only notebook tools over
 * the running service. No creation, no approvals, and no discovery of
 * other chat tools — the set is closed, so a research run can never
 * recurse or write.
 *
 * The sub-model is its own repair loop: an invalid query comes back as
 * the validator's errors in the tool result, and the model fixes and
 * retries within its step budget — there is no nested repair model call.
 * Every embedded result is budgeted through ContextAssembler before it
 * reaches the sub-model (the query layer deliberately never caps a
 * date-bounded match set; the embedder owns the budget).
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

/** Budget for one query result's embedded markdown. */
const QUERY_RESULT_MAX_TOKENS = 30_000
/** Character clamp for a single read or person document. */
const DOC_MAX_CHARS = 24_000
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
  const { tasks, baseDir, today, trace } = opts

  // One store per run, built lazily on the first query that returns
  // documents — lookups and reads never pay for it.
  let storePromise: Promise<MarkdownStore> | null = null
  const getStore = () => (storePromise ??= MarkdownStore.buildFromAll())

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
        for (const p of paths.slice(0, QUERY_READ_CAP)) {
          try {
            docs.push({ doc: Document.fromMarkdown(await readTextFile(p)), path: p })
          } catch {
            // Skip unreadable files
          }
        }
        const collection = DomainCollection.fromDocuments(docs, await getStore(), { depth: 1 })
        const assembler = ContextAssembler.from(collection, {
          scorer: createRecencyTypeScorer(today),
          maxTokens: QUERY_RESULT_MAX_TOKENS,
        })
        for (const kept of assembler.kept) record(kept.item.path)
        return {
          matched: paths.length,
          rendered: assembler.kept.length,
          truncated: truncations.length > 0 ? truncations : undefined,
          markdown: assembler.toMarkdown({ relativeTo: baseDir, delimited: true }),
        }
      },
    },

    notebook_read: {
      description:
        'Read one notebook document in full by its path (as returned by notebook_query or person_lookup). Use after a query surfaced a promising document whose rendered excerpt is not enough.',
      inputSchema: jsonSchema<{ path: string }>({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Notebook-relative document path, e.g. "projects/atlas.md"' },
        },
        required: ['path'],
      }),
      execute: async ({ path: requested }: { path: string }) => {
        const abs = insideNotebook(requested)
        if (!abs) return { success: false, error: 'Path is outside the notebook.' }
        try {
          const markdown = truncate(await readTextFile(abs), DOC_MAX_CHARS, '\n\n[Document truncated]')
          return { path: record(abs), markdown }
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
        const matches: Array<{ path: string; markdown: string }> = []
        for (const file of matched) {
          try {
            matches.push({
              path: record(file),
              markdown: truncate(await readTextFile(file), DOC_MAX_CHARS, '\n\n[Document truncated]'),
            })
          } catch {
            // Skip unreadable files
          }
        }
        return { matches }
      },
    },
  }
}
