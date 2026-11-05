/**
 * Context resolution for AI consumers.
 *
 * Executes a GraphQL query against MarkdownStore, resolves relationships
 * to a given depth via DomainCollection, and returns all documents
 * (root + resolved) as {path, type, markdown} triples.
 */

import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { executeQuery } from '#shared/models/DomainCollection/query/execute.ts'
import type { DomainResolverOptions } from '#shared/models/DomainCollection/query/resolvers/mod.ts'
import _stripHtmlComments from '#shared/models/Markdown/Document/_stripHtmlComments.ts'
import type { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { contactLine, type PersonContact } from '#shared/models/Person/contact.ts'

export interface ContextDocument {
  path: string
  type: string
  markdown: string
  /** For a person: where they stand among your contacts */
  contact?: PersonContact
}

export interface ContextOptions {
  /** Interaction score by name, so people come most active first */
  scoreFor?: (name: string) => number
  /** A person's standing by any of their names, to show beside their profile */
  contactOf?: (names: readonly string[]) => PersonContact | null
}

/** A person's markdown with the contact line right after its frontmatter. */
function withContactLine(markdown: string, line: string): string {
  const front = markdown.match(/^---\n[\s\S]*?\n---\n/)
  return front ? `${front[0]}\n${line}\n${markdown.slice(front[0].length)}` : `${line}\n\n${markdown}`
}

export interface ContextResult {
  documents: ContextDocument[]
  count: number
}

/**
 * Extract all `path` fields from a GraphQL result by walking the data tree.
 */
function extractPaths(data: unknown): string[] {
  const paths: string[] = []

  function walk(obj: unknown) {
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item)
    } else if (obj && typeof obj === 'object') {
      const record = obj as Record<string, unknown>
      if (typeof record.path === 'string') {
        paths.push(record.path)
      }
      for (const value of Object.values(record)) {
        walk(value)
      }
    }
  }

  walk(data)
  return paths
}

/**
 * Execute a GraphQL query, resolve relationships to the given depth,
 * and return all documents in the resulting collection.
 */
const resolverOptionsCache = new WeakMap<(name: string) => number, DomainResolverOptions>()

/** The same options object for the same score lookup: the query runner caches resolvers by it. */
function resolverOptions(options: ContextOptions): DomainResolverOptions | undefined {
  const scoreFor = options.scoreFor
  if (!scoreFor) return undefined
  let cached = resolverOptionsCache.get(scoreFor)
  if (!cached) {
    cached = { scoreFor }
    resolverOptionsCache.set(scoreFor, cached)
  }
  return cached
}

export async function resolveContext(
  query: string,
  depth: number,
  store: MarkdownStore,
  options: ContextOptions = {},
): Promise<ContextResult> {
  const t0 = performance.now()

  // 1. Execute GraphQL query
  const result = await executeQuery<Record<string, unknown>>(query, store, resolverOptions(options))
  const t1 = performance.now()

  if (result.errors?.length) {
    const msg = result.errors.map((e) => e.message).join('; ')
    throw new Error(`GraphQL error: ${msg}`)
  }

  // 2. Extract paths from result
  const paths = [...new Set(extractPaths(result.data))]

  if (paths.length === 0) {
    console.log(`[context] query=${(t1 - t0).toFixed(0)}ms paths=0 total=${(performance.now() - t0).toFixed(0)}ms`)
    return { documents: [], count: 0 }
  }

  // 3. Look up Document objects from store
  const docs: Array<{ doc: Document; path: string }> = []
  for (const p of paths) {
    const found = store.findByPath(p)
    if (found) {
      docs.push({ doc: found.doc, path: p })
    }
  }
  const t2 = performance.now()

  if (docs.length === 0) {
    console.log(
      `[context] query=${(t1 - t0).toFixed(0)}ms paths=${paths.length} lookup=${(t2 - t1).toFixed(0)}ms docs=0 total=${(
        performance.now() - t0
      ).toFixed(0)}ms`,
    )
    return { documents: [], count: 0 }
  }

  // 4. Build DomainCollection with relationship traversal
  const collection = DomainCollection.fromDocuments(docs, store, { depth })
  const t3 = performance.now()

  // 5. Map to response format. Strip comments on the serialized string:
  // Document.stripHtmlComments() re-parses the whole doc to build a new
  // Document, and parse is superlinear on huge list-heavy files — seconds
  // per doc at hundreds of KB, per request.
  const documents: ContextDocument[] = collection.allItems.map((item) => {
    const markdown = _stripHtmlComments(item.doc.toMarkdown())
    if (item.type !== 'person' || !options.contactOf) return { path: item.path, type: item.type, markdown }
    const raw = item.doc.yaml['name']
    const names = (Array.isArray(raw) ? raw : [raw]).filter((name): name is string => typeof name === 'string')
    const contact = options.contactOf(names)
    return {
      path: item.path,
      type: item.type,
      markdown: withContactLine(markdown, contactLine(contact)),
      ...(contact ? { contact } : {}),
    }
  })
  const t4 = performance.now()

  console.log(
    `[context] query=${(t1 - t0).toFixed(0)}ms paths=${paths.length} lookup=${(t2 - t1).toFixed(0)}ms collection=${(
      t3 - t2
    ).toFixed(
      0,
    )}ms (depth=${depth}) toMarkdown=${(t4 - t3).toFixed(0)}ms docs=${documents.length} total=${(t4 - t0).toFixed(0)}ms`,
  )

  return { documents, count: documents.length }
}
