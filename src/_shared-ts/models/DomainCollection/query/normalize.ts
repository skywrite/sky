/**
 * Normalization and validation for AI-generated GraphQL query strings.
 *
 * Models return queries wrapped in markdown code fences, or as bare
 * top-level selections (`meetings(...) { ... }` without the enclosing
 * `{ }`) — both fail to parse. Normalize before execution.
 */

import { parse } from 'graphql'

/**
 * Normalize an AI-generated GraphQL query string:
 * - strips surrounding markdown code fences (``` or ```graphql)
 * - wraps bare selections in `{ ... }` when the string does not already
 *   start with `{` or a `query` operation
 */
export function normalizeGraphQLQuery(query: string): string {
  let q = query.trim()

  if (q.startsWith('```')) {
    q = q.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '')
  }
  if (q.endsWith('```')) {
    q = q.slice(0, -3)
  }
  q = q.trim()

  if (q === '' || q.startsWith('{') || /^query\b/.test(q)) {
    return q
  }
  return `{\n${q}\n}`
}

/**
 * Validate that a query parses as GraphQL. Returns null when valid, else the
 * parse error message. Normalization only fixes shape — models occasionally
 * emit strings that pass it but are not GraphQL at all (e.g. a fragment of
 * their own structured-output envelope like "{changed:true}}"); callers drop
 * those instead of executing them or carrying them forward as live queries.
 */
export function graphQLParseError(query: string): string | null {
  try {
    parse(query)
    return null
  } catch (err) {
    return (err as Error).message
  }
}
