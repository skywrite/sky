/**
 * Normalization and validation for AI-generated GraphQL query strings.
 *
 * Models return queries wrapped in markdown code fences, or as bare
 * top-level selections (`meetings(...) { ... }` without the enclosing
 * `{ }`) — both fail to parse. They also select the same root field twice
 * with different arguments and no aliases — parses fine, but execution
 * rejects it ("Fields conflict because they have differing arguments").
 * And they misplace filter keys in field-argument position
 * (`journals(recent: "7d")`, `documents(where: {...}, involves: "X")`) —
 * parses fine, but validation rejects the whole document ("Unknown
 * argument"). And they select `when` bare — it was a scalar until the When
 * value type shipped — which validation rejects ("must have a selection of
 * subfields"). Normalize before execution.
 */

import type {
  ArgumentNode,
  DefinitionNode,
  DocumentNode,
  FieldNode,
  ObjectFieldNode,
  OperationDefinitionNode,
  SelectionNode,
} from 'graphql'
import { Kind, OperationTypeNode, parse, print, validate, visit } from 'graphql'
import { getSchema } from './execute.ts'

/**
 * Normalize an AI-generated GraphQL query string:
 * - strips markdown code fences (``` or ```graphql), and merges the root
 *   selections when the model emitted several fenced blocks instead of one
 *   query — the interior fences otherwise break the whole document
 * - wraps bare selections in `{ ... }` when the string does not already
 *   start with `{` or a `query` operation
 * - hoists filter keys misplaced as field arguments into `where`
 *   (`journals(recent: "7d")` → `journals(where: {recent: "7d"})`) —
 *   models emit these and validation rejects the whole document
 * - auto-aliases same-name fields with differing arguments
 *   (`messages2: messages(...)`) — models emit these despite the prompts
 *   telling them to alias, and GraphQL rejects the whole query as a
 *   field-merge conflict
 */
export function normalizeGraphQLQuery(query: string): string {
  const chunks = fenceChunks(query).map(wrapBareSelection)
  if (chunks.length === 0) {
    return ''
  }

  // One chunk is the overwhelmingly common case; pass it through untouched so
  // formatting survives. Only a multi-block reply needs the reparse to merge.
  const q = chunks.length === 1 ? chunks[0] : mergeTopLevelSelections(chunks)

  return autoAliasConflictingFields(hoistMisplacedFilterArgs(q))
}

/**
 * Split model output on fence lines into candidate query chunks.
 *
 * Fences are treated as separators rather than as a wrapper to strip, because
 * models routinely emit several ```graphql blocks (and prose between them)
 * when asked for one query. Anchored stripping leaves the interior fences in
 * place and the whole document fails to parse on a backtick.
 */
function fenceChunks(text: string): string[] {
  return text
    .split(/^[ \t]*```[a-zA-Z0-9_-]*[ \t]*\r?$/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '')
}

/** Models emit `meetings(...) { ... }` without the enclosing braces. */
function wrapBareSelection(chunk: string): string {
  return chunk.startsWith('{') || /^query\b/.test(chunk) ? chunk : `{\n${chunk}\n}`
}

/**
 * Fold several query documents into one by concatenating their root
 * selections. Chunks that don't parse — prose the model mixed in — are
 * dropped. Aliases already present are preserved, and any same-name
 * collisions the merge creates are resolved by autoAliasConflictingFields.
 */
function mergeTopLevelSelections(chunks: string[]): string {
  const selections: SelectionNode[] = []

  for (const chunk of chunks) {
    let doc: DocumentNode
    try {
      doc = parse(chunk)
    } catch {
      continue
    }
    for (const def of doc.definitions) {
      if (def.kind === Kind.OPERATION_DEFINITION && def.operation === OperationTypeNode.QUERY) {
        selections.push(...def.selectionSet.selections)
      }
    }
  }

  // Nothing parsed — hand back the first chunk so the caller reports a real
  // GraphQL syntax error against actual content rather than an empty string.
  if (selections.length === 0) {
    return chunks[0]
  }

  return print({
    kind: Kind.DOCUMENT,
    definitions: [
      {
        kind: Kind.OPERATION_DEFINITION,
        operation: OperationTypeNode.QUERY,
        selectionSet: { kind: Kind.SELECTION_SET, selections },
      },
    ],
  })
}

/** The only arguments root query fields accept (see dev/schema/generate.ts). */
const ROOT_FIELD_ARGS = new Set(['where', 'limit'])

/**
 * Move filter keys the model left in field-argument position into `where`.
 * `journals(recent: "7d", limit: 10)` and `documents(where: {...},
 * involves: "X")` both fail validation with "Unknown argument" — and one
 * such slip voids the whole document — yet the intent is unambiguous
 * because root query fields take only `where` and `limit`. Strays merge
 * into the existing `where` object without overwriting keys it already
 * has; a `where` that is not an object literal (e.g. a variable) leaves
 * the selection untouched for validation to report. Only top-level
 * selections of query operations are rewritten.
 */
function hoistMisplacedFilterArgs(query: string): string {
  let doc: DocumentNode
  try {
    doc = parse(query)
  } catch {
    return query
  }

  let changed = false
  const definitions = doc.definitions.map((def) => {
    if (def.kind !== Kind.OPERATION_DEFINITION || def.operation !== 'query') return def
    const selections = def.selectionSet.selections.map((sel) => {
      if (sel.kind !== Kind.FIELD) return sel
      const args = sel.arguments ?? []
      const strays = args.filter((a) => !ROOT_FIELD_ARGS.has(a.name.value))
      if (strays.length === 0) return sel

      const where = args.find((a) => a.name.value === 'where')
      if (where && where.value.kind !== Kind.OBJECT) return sel

      const merged = new Map<string, ObjectFieldNode>()
      if (where?.value.kind === Kind.OBJECT) {
        for (const field of where.value.fields) merged.set(field.name.value, field)
      }
      for (const stray of strays) {
        if (!merged.has(stray.name.value)) {
          merged.set(stray.name.value, { kind: Kind.OBJECT_FIELD, name: stray.name, value: stray.value })
        }
      }

      const whereArg: ArgumentNode = {
        kind: Kind.ARGUMENT,
        name: { kind: Kind.NAME, value: 'where' },
        value: { kind: Kind.OBJECT, fields: [...merged.values()] },
      }
      changed = true
      return {
        ...sel,
        arguments: [whereArg, ...args.filter((a) => a !== where && !strays.includes(a))],
      } as FieldNode
    })
    return { ...def, selectionSet: { ...def.selectionSet, selections } } as OperationDefinitionNode
  })

  return changed ? print({ ...doc, definitions }) : query
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
 * Object-typed fields models habitually select bare, and the subselection
 * that repairs them. `when` was a scalar string until the When value type
 * shipped; models still write `messages { when }` and one such selection
 * voids the whole document. A bare `when` always meant the datetime.
 */
const DEFAULT_SUBFIELDS: Record<string, readonly string[]> = {
  When: ['datetime'],
}

/**
 * Expand object-typed fields selected with no subselection into their
 * default subselection (`when` → `when { datetime }`).
 *
 * Driven by the validator's own errors rather than field names: only nodes
 * the schema flags with "must have a selection of subfields", and only when
 * the field's type has an entry in DEFAULT_SUBFIELDS. Same-named scalar
 * fields (Chat.when is a plain string) validate clean and are never
 * touched, and composite types outside the table keep their error for the
 * model-repair round — this repair fires only where the fix is mechanical.
 * Unparseable input is returned as-is for graphQLParseError to report.
 */
export async function expandMissingSubfields(query: string): Promise<string> {
  let doc: DocumentNode
  try {
    doc = parse(query)
  } catch {
    return query
  }

  const targets = new Map<FieldNode, readonly string[]>()
  for (const error of validate(await getSchema(), doc)) {
    const type = /^Field "[^"]+" of type "([^"]+)" must have a selection of subfields/.exec(error.message)?.[1]
    const subfields = type && DEFAULT_SUBFIELDS[type.replace(/[[\]!]/g, '')]
    const node = error.nodes?.[0]
    if (subfields && node?.kind === Kind.FIELD) targets.set(node, subfields)
  }
  if (targets.size === 0) return query

  return print(
    visit(doc, {
      Field(node) {
        const subfields = targets.get(node)
        if (!subfields) return undefined
        const selections = subfields.map(
          (name): FieldNode => ({ kind: Kind.FIELD, name: { kind: Kind.NAME, value: name } }),
        )
        return { ...node, selectionSet: { kind: Kind.SELECTION_SET, selections } } as FieldNode
      },
    }),
  )
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

export interface DroppedSelection {
  key: string
  errors: string[]
}

export interface SalvagedQuery {
  query: string
  dropped: DroppedSelection[]
}

/**
 * Drop schema-invalid top-level selections so the rest of the document can
 * execute. GraphQL validates the whole document before running any of it,
 * so one bad alias among eight costs all eight — once generation-time
 * repairs are exhausted (or a stored query has gone stale against a newer
 * schema), losing one selection beats losing the whole context fetch.
 *
 * Each validation error is attributed to the top-level selection whose
 * source range contains the error's node; flagged selections are removed
 * and the remainder re-validated until clean. Returns null when nothing
 * salvageable remains: unparseable input, an error that cannot be pinned
 * to a top-level selection (e.g. an orphaned variable definition), or no
 * surviving selections. A valid document comes back unchanged with an
 * empty `dropped` list.
 */
export async function dropInvalidSelections(query: string): Promise<SalvagedQuery | null> {
  const schema = await getSchema()
  const dropped: DroppedSelection[] = []
  let current = query

  // Each round removes at least one selection, so rounds are bounded by
  // the top-level selection count; the cap is a defensive backstop.
  for (let round = 0; round < 32; round++) {
    let doc: DocumentNode
    try {
      doc = parse(current)
    } catch {
      return null
    }

    const errors = validate(schema, doc)
    if (errors.length === 0) {
      return { query: current, dropped }
    }

    const topSelections = doc.definitions
      .filter((d) => d.kind === Kind.OPERATION_DEFINITION)
      .flatMap((op) => op.selectionSet.selections)
      .filter((s) => s.kind === Kind.FIELD)

    const invalid = new Map<FieldNode, string[]>()
    for (const error of errors) {
      const loc = error.nodes?.[0]?.loc
      const owner = loc && topSelections.find((s) => s.loc && s.loc.start <= loc.start && loc.end <= s.loc.end)
      if (!owner) return null
      const messages = invalid.get(owner)
      if (messages) messages.push(error.message)
      else invalid.set(owner, [error.message])
    }

    for (const [sel, messages] of invalid) {
      dropped.push({ key: (sel.alias ?? sel.name).value, errors: messages })
    }

    const definitions = doc.definitions.flatMap((def): DefinitionNode[] => {
      if (def.kind !== Kind.OPERATION_DEFINITION) return [def]
      const selections = def.selectionSet.selections.filter((s) => s.kind !== Kind.FIELD || !invalid.has(s))
      if (selections.length === 0) return []
      return [{ ...def, selectionSet: { ...def.selectionSet, selections } } as OperationDefinitionNode]
    })
    if (!definitions.some((d) => d.kind === Kind.OPERATION_DEFINITION)) return null

    current = print({ ...doc, definitions })
  }
  return null
}
