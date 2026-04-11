/**
 * Selector → GraphQL Transpiler.
 *
 * Converts CSS-inspired selector syntax to GraphQL queries.
 */

import { type ParsedAttribute, type ParsedPseudo, type ParsedSelector, parseSelector } from './parser.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * Result of transpilation.
 */
export interface TranspileResult {
  query: string
  variables: Record<string, unknown>
}

/**
 * Transpile a selector string to GraphQL query.
 *
 * @example
 * selectorToGraphQL('meeting:recent(7d)')
 * // { query: 'query { meetings(where: { recent: "7d" }) { path markdown } }', variables: {} }
 */
export function selectorToGraphQL(selector: string, options: { today?: PlainDate } = {}): TranspileResult {
  const parsed = parseSelector(selector)
  const queries: string[] = []
  const variables: Record<string, unknown> = {}

  for (const sel of parsed) {
    const { queryName, filterArgs } = buildQuery(sel, options)
    if (filterArgs) {
      queries.push(`${queryName}(where: { ${filterArgs} }) { path markdown }`)
    } else {
      queries.push(`${queryName} { path markdown }`)
    }
  }

  return {
    query: `query { ${queries.join(' ')} }`,
    variables,
  }
}

/**
 * Build query parts from a parsed selector.
 */
function buildQuery(sel: ParsedSelector, options: { today?: PlainDate }): { queryName: string; filterArgs: string } {
  const queryName = pluralize(sel.type)
  const filters: string[] = []

  // Process pseudo-classes first (for consistent ordering)
  for (const pseudo of sel.pseudos) {
    const filter = pseudoToFilter(pseudo, options)
    if (filter) filters.push(filter)
  }

  // Then process attributes — collect repeated tags~= into tags_contains_all
  const tagContainsValues: string[] = []
  for (const attr of sel.attributes) {
    if (attr.name === 'tags' && attr.operator === '~=') {
      tagContainsValues.push(attr.value)
    } else {
      const filter = attributeToFilter(attr)
      if (filter) filters.push(filter)
    }
  }
  if (tagContainsValues.length === 1) {
    filters.push(`tags_contains: "${tagContainsValues[0]}"`)
  } else if (tagContainsValues.length > 1) {
    const items = tagContainsValues.map((v) => `"${v}"`).join(', ')
    filters.push(`tags_contains_all: [${items}]`)
  }

  return {
    queryName,
    filterArgs: filters.join(', '),
  }
}

/**
 * Convert attribute selector to GraphQL filter.
 */
function attributeToFilter(attr: ParsedAttribute): string | null {
  const { name, operator, value } = attr

  switch (operator) {
    case '=':
      // Exact match
      if (name === 'year' || name === 'month') {
        return `${name}: ${value}`
      }
      return `${name}: "${value}"`

    case '~=':
      // Contains (for arrays)
      return `${name}_contains: "${value}"`

    case '^=':
      // Starts with
      return `${name}_starts_with: "${value}"`

    case '$=':
      // Ends with
      return `${name}_ends_with: "${value}"`

    case '*=':
      // Substring
      return `${name}_contains: "${value}"`

    case 'exists':
      // Field exists
      return `${name}_exists: true`

    default:
      return null
  }
}

/**
 * Convert pseudo-class to GraphQL filter.
 */
function pseudoToFilter(pseudo: ParsedPseudo, options: { today?: PlainDate }): string | null {
  const today = options.today ?? PlainDate.today()

  switch (pseudo.name) {
    case 'today':
      return `date: "${today.ymd}"`

    case 'yesterday': {
      const yesterday = today.addDays(-1)
      return `date: "${yesterday.ymd}"`
    }

    case 'recent':
      return `recent: "${pseudo.value ?? '7d'}"`

    case 'date':
      return `date: "${pseudo.value}"`

    case 'date-range':
      if (pseudo.value) {
        const [start, end] = pseudo.value.split(',').map((s) => s.trim())
        return `date_gte: "${start}", date_lte: "${end}"`
      }
      return null

    case 'pending':
      return 'pending: true'

    case 'decided':
      return 'decided: true'

    case 'involves':
      return `involves: "${pseudo.value}"`

    case 'contains':
      return `body_contains: "${pseudo.value}"`

    case 'matches':
      return `body_matches: "${pseudo.value}"`

    case 'has':
      // Parse inner selector and extract filter
      if (pseudo.innerSelector) {
        return innerSelectorToFilter(pseudo.innerSelector)
      }
      return null

    case 'not':
      // Handle negation
      if (pseudo.innerSelector) {
        return innerSelectorToNotFilter(pseudo.innerSelector)
      }
      return null

    case 'with-related':
      // This doesn't translate to a filter, it's a traversal option
      return null

    default:
      return null
  }
}

/**
 * Convert inner selector (from :has) to filter.
 */
function innerSelectorToFilter(sel: ParsedSelector): string | null {
  const filters: string[] = []

  for (const attr of sel.attributes) {
    if (attr.name === 'who' && attr.operator === '~=') {
      filters.push(`who_contains: "${attr.value}"`)
    } else if (attr.name === 'from' && attr.operator === '=') {
      filters.push(`from: "${attr.value}"`)
    } else if (attr.name === 'to' && attr.operator === '~=') {
      filters.push(`to_contains: "${attr.value}"`)
    } else if (attr.name === 'org' && attr.operator === '=') {
      filters.push(`org: "${attr.value}"`)
    } else if (attr.operator === '~=') {
      filters.push(`${attr.name}_contains: "${attr.value}"`)
    } else if (attr.operator === '=') {
      filters.push(`${attr.name}: "${attr.value}"`)
    }
  }

  return filters.join(', ') || null
}

/**
 * Convert inner selector (from :not) to negation filter.
 */
function innerSelectorToNotFilter(sel: ParsedSelector): string | null {
  const filters: string[] = []

  for (const attr of sel.attributes) {
    if (attr.operator === 'exists' || !attr.value) {
      // :not([field]) → field is null
      filters.push(`${attr.name}_is_null: true`)
    } else if (attr.operator === '~=') {
      filters.push(`${attr.name}_not_contains: "${attr.value}"`)
    } else if (attr.operator === '^=') {
      filters.push(`${attr.name}_not_starts_with: "${attr.value}"`)
    } else if (attr.operator === '=') {
      filters.push(`${attr.name}_not: "${attr.value}"`)
    }
  }

  // Handle :not(:has(...))
  for (const pseudo of sel.pseudos) {
    if (pseudo.name === 'has' && pseudo.innerSelector) {
      for (const attr of pseudo.innerSelector.attributes) {
        if (attr.name === 'who' && attr.operator === '~=') {
          filters.push(`who_not_contains: "${attr.value}"`)
        } else if (attr.name === 'from' && attr.operator === '=') {
          filters.push(`from_not: "${attr.value}"`)
        }
      }
    }
  }

  return filters.join(', ') || null
}

/**
 * Pluralize type name for GraphQL query.
 */
function pluralize(type: string): string {
  switch (type) {
    case 'meeting':
      return 'meetings'
    case 'message':
      return 'messages'
    case 'video':
      return 'videos'
    case 'person':
      return 'people'
    case 'org':
      return 'orgs'
    case 'project':
      return 'projects'
    case 'decision':
      return 'decisions'
    case 'goal':
      return 'goals'
    case 'idea':
      return 'ideas'
    case 'day':
      return 'days'
    case 'journal':
      return 'journals'
    case '*':
    case 'document':
    default:
      return 'documents'
  }
}
