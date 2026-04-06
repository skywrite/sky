/**
 * GraphQL query executor for DomainCollection.
 *
 * Executes GraphQL queries against MarkdownStore using the DomainCollection resolvers.
 * Can be used standalone (CLI) or integrated with graphql-yoga (server).
 */

import { buildSchema, graphql, type GraphQLSchema } from 'graphql'
import { readTextFile } from '#shared/fs/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { createDomainResolvers } from './resolvers.ts'

// Cache the schema string and built schema
let schemaString: string | null = null
let cachedSchema: GraphQLSchema | null = null

/**
 * Load the GraphQL schema from file.
 */
async function loadSchema(): Promise<string> {
  if (schemaString) return schemaString

  const schemaPath = new URL('./schema.graphql', import.meta.url).pathname
  schemaString = await readTextFile(schemaPath)
  return schemaString
}

/**
 * Get or build the cached GraphQL schema.
 * Call at startup to avoid a ~6s cold-start on first executeQuery().
 */
export async function getSchema(): Promise<GraphQLSchema> {
  if (cachedSchema) return cachedSchema
  const typeDefs = await loadSchema()
  cachedSchema = buildSchema(typeDefs)
  return cachedSchema
}

/**
 * Build a GraphQL schema with resolvers bound to a MarkdownStore.
 */
export async function buildDomainSchema(_store: MarkdownStore): Promise<GraphQLSchema> {
  return getSchema()
}

/**
 * Result of a GraphQL query execution.
 */
export interface ExecuteResult<T = unknown> {
  data: T | null
  errors?: Array<{ message: string; path?: string[] }>
}

/**
 * Execute a GraphQL query against a MarkdownStore.
 *
 * @example
 * const result = await executeQuery(
 *   `{ meetings(where: { recent: "7d" }) { who summary path } }`,
 *   store
 * )
 */
// Cache resolvers: DomainCollection.fromStore() is expensive (~6s for 20k docs).
// Invalidated when store is mutated via set()/delete().
let cachedResolversStore: MarkdownStore | null = null
let cachedResolvers: ReturnType<typeof createDomainResolvers> | null = null

/**
 * Invalidate the cached resolvers. Call after MarkdownStore.set()/delete()
 * so the next executeQuery() rebuilds from the updated store.
 */
export function resetResolverCache(): void {
  cachedResolvers = null
  cachedResolversStore = null
}

export async function executeQuery<T = unknown>(query: string, store: MarkdownStore): Promise<ExecuteResult<T>> {
  const schema = await getSchema()

  // Cache resolvers: DomainCollection.fromStore() is expensive (~6s for 20k docs).
  // Reuse if same store instance; callers should invalidate via resetResolverCache()
  // when the store is mutated.
  if (store !== cachedResolversStore || !cachedResolvers) {
    cachedResolvers = createDomainResolvers(store)
    cachedResolversStore = store
  }

  const result = await graphql({
    schema,
    source: query,
    rootValue: cachedResolvers,
  })

  return {
    data: result.data as T | null,
    errors: result.errors?.map((e) => ({
      message: e.message,
      path: e.path?.map(String),
    })),
  }
}

/**
 * Check if a string looks like a GraphQL query (vs CSS selector).
 */
export function isGraphQL(query: string): boolean {
  const trimmed = query.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('query ') || trimmed.startsWith('query{')
}

/**
 * Get the schema string for use in prompts or introspection.
 */
export async function getSchemaString(): Promise<string> {
  return loadSchema()
}
