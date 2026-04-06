/**
 * Context resolution for AI consumers.
 *
 * Executes a GraphQL query against MarkdownStore, resolves relationships
 * to a given depth via DomainCollection, and returns all documents
 * (root + resolved) as {path, type, markdown} triples.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { executeQuery } from '#shared/models/DomainCollection/query/execute.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'

export interface ContextDocument {
  path: string
  type: string
  markdown: string
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
export async function resolveContext(query: string, depth: number, store: MarkdownStore): Promise<ContextResult> {
  const t0 = performance.now()

  // 1. Execute GraphQL query
  const result = await executeQuery<Record<string, unknown>>(query, store)
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

  // 5. Map to response format
  const documents: ContextDocument[] = collection.allItems.map((item) => ({
    path: item.path,
    type: item.type,
    markdown: item.doc.toMarkdown(),
  }))
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
