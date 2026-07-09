/**
 * Normalization and validation for AI-generated GraphQL query strings.
 *
 * Models return queries wrapped in markdown code fences, or as bare
 * top-level selections (`meetings(...) { ... }` without the enclosing
 * `{ }`) — both fail to parse. They also select the same root field twice
 * with different arguments and no aliases — parses fine, but execution
 * rejects it ("Fields conflict because they have differing arguments").
 * Normalize before execution.
 */

import type { DocumentNode, FieldNode } from 'graphql'
import { Kind, parse, print, validate, visit } from 'graphql'
import { getSchema } from './execute.ts'

/**
 * Normalize an AI-generated GraphQL query string:
 * - strips surrounding markdown code fences (``` or ```graphql)
 * - wraps bare selections in `{ ... }` when the string does not already
 *   start with `{` or a `query` operation
 * - auto-aliases same-name fields with differing arguments
 *   (`messages2: messages(...)`) — models emit these despite the prompts
 *   telling them to alias, and GraphQL rejects the whole query as a
 *   field-merge conflict
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

  if (q === '') {
    return q
  }
  if (!(q.startsWith('{') || /^query\b/.test(q))) {
    q = `{\n${q}\n}`
  }
  return autoAliasConflictingFields(q)
}

/**
 * Response-shape identity of a field selection: two same-key selections
 * merge cleanly only when field name and arguments match (argument order
 * is irrelevant in GraphQL, hence the sort). Anything else is a conflict.
 */
function fieldSignature(field: FieldNode): string {
  const args = (field.arguments ?? [])
    .map((a) => print(a))
    .sort()
    .join(',')
  return `${field.name.value}(${args})`
}

/**
 * Alias away field-merge conflicts: within each selection set, when the same
 * response key is selected more than once with differing name/arguments, the
 * second and later occurrences get numbered aliases (`messages2:`). The query
 * means exactly what the model intended, so repairing beats rejecting.
 * Identical duplicates are left alone (GraphQL merges them), and unparseable
 * strings are returned as-is for graphQLParseError / execution to report.
 */
function autoAliasConflictingFields(query: string): string {
  let doc: DocumentNode
  try {
    doc = parse(query)
  } catch {
    return query
  }

  let changed = false
  const rewritten = visit(doc, {
    SelectionSet(node) {
      const fieldsByKey = new Map<string, FieldNode[]>()
      for (const sel of node.selections) {
        if (sel.kind !== Kind.FIELD) continue
        const key = sel.alias?.value ?? sel.name.value
        const group = fieldsByKey.get(key)
        if (group) group.push(sel)
        else fieldsByKey.set(key, [sel])
      }

      const conflicting = new Set<string>()
      for (const [key, fields] of fieldsByKey) {
        if (fields.length > 1 && new Set(fields.map(fieldSignature)).size > 1) {
          conflicting.add(key)
        }
      }
      if (conflicting.size === 0) return undefined

      const usedKeys = new Set(fieldsByKey.keys())
      const occurrences = new Map<string, number>()
      const selections = node.selections.map((sel) => {
        if (sel.kind !== Kind.FIELD) return sel
        const key = sel.alias?.value ?? sel.name.value
        if (!conflicting.has(key)) return sel
        const occurrence = (occurrences.get(key) ?? 0) + 1
        occurrences.set(key, occurrence)
        if (occurrence === 1) return sel

        let suffix = occurrence
        let alias = `${key}${suffix}`
        while (usedKeys.has(alias)) alias = `${key}${++suffix}`
        usedKeys.add(alias)
        changed = true
        return { ...sel, alias: { kind: Kind.NAME, value: alias } } as FieldNode
      })
      return { ...node, selections }
    },
  })

  return changed ? print(rewritten) : query
}

/**
 * Validate that a query parses as GraphQL. Returns null when valid, else the
 * parse error message. Normalization fixes shape and merge conflicts but
 * never rejects — models occasionally emit strings that are not GraphQL at
 * all (e.g. a fragment of their own structured-output envelope like
 * "{changed:true}}"); callers drop those instead of executing them or
 * carrying them forward as live queries.
 */
export function graphQLParseError(query: string): string | null {
  try {
    parse(query)
    return null
  } catch (err) {
    return (err as Error).message
  }
}

/**
 * Validate a query against the notebook schema. Returns null when valid,
 * else the error messages — parse failures and schema-validation failures
 * (hallucinated filter fields, bad argument types, merge conflicts) in one
 * guard, so callers drop exactly what the executor would reject.
 */
export async function graphQLValidationErrors(query: string): Promise<string[] | null> {
  let doc: DocumentNode
  try {
    doc = parse(query)
  } catch (err) {
    return [(err as Error).message]
  }
  const errors = validate(await getSchema(), doc)
  return errors.length > 0 ? errors.map((e) => e.message) : null
}
