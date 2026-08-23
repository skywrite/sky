/**
 * Selector Parser for query syntax.
 *
 * Parses CSS-inspired selector syntax into a structured AST.
 *
 * Syntax:
 *   type[attr="value"][attr~="value"]:pseudo(arg)
 *
 * Type selectors: meeting, person, message, decision, project, org, day, *
 * Attribute operators: = (exact), ~= (contains), ^= (starts), $= (ends), *= (substring)
 * Pseudo-classes: :today, :yesterday, :recent(7d), :pending, :involves("name"), :has([attr])
 */

/**
 * Document type for filtering.
 */
export type DocumentType =
  | 'meeting'
  | 'message'
  | 'video'
  | 'recap'
  | 'person'
  | 'org'
  | 'project'
  | 'decision'
  | 'goal'
  | 'streak'
  | 'tracking'
  | 'idea'
  | 'place'
  | 'day'
  | 'journal'
  | 'chat'
  | 'document'

/**
 * Parsed attribute selector.
 */
export interface ParsedAttribute {
  name: string
  operator: '=' | '~=' | '^=' | '$=' | '*=' | 'exists'
  value: string
}

/**
 * Parsed pseudo-class.
 */
export interface ParsedPseudo {
  name: string
  value?: string
  innerSelector?: ParsedSelector
}

/**
 * Parsed selector (single selector, not comma-separated).
 */
export interface ParsedSelector {
  type: DocumentType | '*'
  attributes: ParsedAttribute[]
  pseudos: ParsedPseudo[]
}

/**
 * Parse a selector string into structured AST.
 *
 * @example
 * parseSelector('meeting:recent(7d)')
 * // [{ type: 'meeting', attributes: [], pseudos: [{ name: 'recent', value: '7d' }] }]
 *
 * parseSelector('person[org="MoonPay"]')
 * // [{ type: 'person', attributes: [{ name: 'org', operator: '=', value: 'MoonPay' }], pseudos: [] }]
 */
export function parseSelector(selector: string): ParsedSelector[] {
  const results: ParsedSelector[] = []

  // Split by comma for OR (union) - but be careful of commas inside quotes/parens
  const parts = splitByComma(selector)

  for (const part of parts) {
    results.push(parseSingleSelector(part.trim()))
  }

  return results
}

/**
 * Split selector string by comma, respecting quotes and parentheses.
 */
function splitByComma(selector: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let inQuote = false
  let quoteChar = ''

  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]

    if (!inQuote && (char === '"' || char === "'")) {
      inQuote = true
      quoteChar = char
      current += char
    } else if (inQuote && char === quoteChar) {
      inQuote = false
      quoteChar = ''
      current += char
    } else if (!inQuote && (char === '(' || char === '[')) {
      depth++
      current += char
    } else if (!inQuote && (char === ')' || char === ']')) {
      depth--
      current += char
    } else if (!inQuote && depth === 0 && char === ',') {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) {
    parts.push(current)
  }

  return parts
}

/**
 * Parse a single selector (no commas).
 */
function parseSingleSelector(selector: string): ParsedSelector {
  const result: ParsedSelector = {
    type: 'document',
    attributes: [],
    pseudos: [],
  }

  let remaining = selector.trim()

  // Parse type selector (at the start)
  const typeMatch = remaining.match(/^([a-z*]+)/)
  if (typeMatch) {
    result.type = mapType(typeMatch[1])
    remaining = remaining.slice(typeMatch[0].length)
  }

  // Parse attribute selectors [attr="value"]
  while (remaining.startsWith('[')) {
    const attrEnd = findMatchingBracket(remaining, '[', ']')
    if (attrEnd === -1) {
      throw new Error(`Unmatched bracket in selector: ${selector}`)
    }

    const attrContent = remaining.slice(1, attrEnd)
    result.attributes.push(parseAttribute(attrContent))
    remaining = remaining.slice(attrEnd + 1)
  }

  // Parse pseudo-classes :name or :name(arg)
  while (remaining.startsWith(':')) {
    remaining = remaining.slice(1) // skip ':'

    // Get pseudo name
    const nameMatch = remaining.match(/^([a-z-]+)/)
    if (!nameMatch) {
      throw new Error(`Invalid pseudo-class in selector: ${selector}`)
    }

    const pseudoName = nameMatch[1]
    remaining = remaining.slice(pseudoName.length)

    const pseudo: ParsedPseudo = { name: pseudoName }

    // Check for argument in parentheses
    if (remaining.startsWith('(')) {
      const parenEnd = findMatchingBracket(remaining, '(', ')')
      if (parenEnd === -1) {
        throw new Error(`Unmatched parenthesis in selector: ${selector}`)
      }

      const argContent = remaining.slice(1, parenEnd).trim()

      // Check if this is a nested selector (for :has, :not)
      if (pseudoName === 'has' || pseudoName === 'not') {
        if (argContent.startsWith('[')) {
          pseudo.innerSelector = parseSingleSelector(argContent)
        } else {
          pseudo.innerSelector = parseSingleSelector(argContent)
        }
      } else {
        // Remove surrounding quotes if present
        pseudo.value = stripQuotes(argContent)
      }

      remaining = remaining.slice(parenEnd + 1)
    }

    result.pseudos.push(pseudo)

    // Continue parsing attributes after pseudo-classes
    while (remaining.startsWith('[')) {
      const attrEnd = findMatchingBracket(remaining, '[', ']')
      if (attrEnd === -1) break

      const attrContent = remaining.slice(1, attrEnd)
      result.attributes.push(parseAttribute(attrContent))
      remaining = remaining.slice(attrEnd + 1)
    }
  }

  return result
}

/**
 * Map type string to DocumentType.
 */
function mapType(type: string): DocumentType | '*' {
  switch (type) {
    case 'meeting':
    case 'message':
    case 'video':
    case 'recap':
    case 'person':
    case 'org':
    case 'project':
    case 'decision':
    case 'goal':
    case 'streak':
    case 'tracking':
    case 'idea':
    case 'place':
    case 'day':
    case 'journal':
    case 'chat':
      return type
    case '*':
      return '*'
    default:
      return 'document'
  }
}

/**
 * Parse attribute content like: attr="value" or attr~="value"
 */
function parseAttribute(content: string): ParsedAttribute {
  // Check for different operators
  const operators = ['~=', '^=', '$=', '*=', '=']

  for (const op of operators) {
    const idx = content.indexOf(op)
    if (idx !== -1) {
      const name = content.slice(0, idx).trim()
      const value = stripQuotes(content.slice(idx + op.length).trim())
      return { name, operator: op as ParsedAttribute['operator'], value }
    }
  }

  // No operator = existence check
  return { name: content.trim(), operator: 'exists', value: '' }
}

/**
 * Find matching closing bracket.
 */
function findMatchingBracket(str: string, open: string, close: string): number {
  let depth = 0
  let inQuote = false
  let quoteChar = ''

  for (let i = 0; i < str.length; i++) {
    const char = str[i]

    if (!inQuote && (char === '"' || char === "'")) {
      inQuote = true
      quoteChar = char
    } else if (inQuote && char === quoteChar) {
      inQuote = false
      quoteChar = ''
    } else if (!inQuote) {
      if (char === open) depth++
      else if (char === close) {
        depth--
        if (depth === 0) return i
      }
    }
  }

  return -1
}

/**
 * Remove surrounding quotes from a string.
 */
function stripQuotes(str: string): string {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1)
  }
  return str
}
