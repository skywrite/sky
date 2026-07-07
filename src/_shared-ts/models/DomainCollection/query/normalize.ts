/**
 * Normalization for AI-generated GraphQL query strings.
 *
 * Models return queries wrapped in markdown code fences, or as bare
 * top-level selections (`meetings(...) { ... }` without the enclosing
 * `{ }`) — both fail to parse. Normalize before execution.
 */

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
