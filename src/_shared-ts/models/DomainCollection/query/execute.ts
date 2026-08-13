/**
 * GraphQL query executor for DomainCollection.
 *
 * Executes GraphQL queries against MarkdownStore using the DomainCollection resolvers.
 * Can be used standalone (CLI) or integrated with graphql-yoga (server).
 */

import { buildSchema, graphql, type GraphQLSchema } from 'graphql'
import { readTextFile } from '#shared/fs/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { createDomainResolvers } from './resolvers/mod.ts'
import type { QueryTruncation } from './resolvers/shared.ts'

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
  /** Root fields whose result hit a cap — present only when something was cut. */
  truncations?: QueryTruncation[]
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
// Cache resolvers: DomainCollection.fromStore() rebuilds the whole collection
// (~55ms on the production store) — skip that when nothing changed. The cache
// is keyed on the store instance AND its version, so MarkdownStore.set()/
// delete() invalidate it implicitly via the version bump; there is no reset
// to remember to call. This cache is independent of the yoga delegates' cache
// (liveDc() in service/graphql/schema.ts) — both compare against the same
// store counter, which is why it is a counter and not a dirty flag one cache
// would clear for the other.
let cachedResolversStore: MarkdownStore | null = null
let cachedResolversVersion = -1
let cachedResolvers: ReturnType<typeof createDomainResolvers> | null = null

export async function executeQuery<T = unknown>(query: string, store: MarkdownStore): Promise<ExecuteResult<T>> {
  const schema = await getSchema()

  // Reuse resolvers while the same store instance sits at the same version;
  // any set()/delete() moves the version and forces a rebuild here.
  if (store !== cachedResolversStore || store.version !== cachedResolversVersion || !cachedResolvers) {
    cachedResolvers = createDomainResolvers(store)
    cachedResolversStore = store
    cachedResolversVersion = store.version
  }

  // Resolvers report capped root fields here; see QueryTruncation.
  const truncations: QueryTruncation[] = []
  const result = await graphql({
    schema,
    source: query,
    rootValue: cachedResolvers,
    contextValue: { truncations },
  })

  return {
    data: result.data as T | null,
    errors: result.errors?.map((e) => ({
      message: e.message,
      path: e.path?.map(String),
    })),
    ...(truncations.length > 0 ? { truncations } : {}),
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
