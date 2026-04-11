import * as YAML from 'yaml'

export interface StringifyOptions {
  // Options to match our current js-yaml configuration
  quotingType?: '"' | "'"
  lineWidth?: number
  nullStr?: string
  /**
   * Preferred key order for top-level YAML keys.
   * Keys in this array appear first (in order), then remaining keys follow.
   */
  keyOrder?: string[]
}

/**
 * Reorder object keys according to a preferred order.
 * Keys in `order` appear first (in that order), then remaining keys in original order.
 */
function reorderKeys(obj: Record<string, unknown>, order: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const existingKeys = new Set(Object.keys(obj))

  // Add keys from the order list first (if they exist in obj)
  for (const key of order) {
    if (existingKeys.has(key)) {
      result[key] = obj[key]
      existingKeys.delete(key)
    }
  }

  // Add remaining keys in their original order
  for (const key of Object.keys(obj)) {
    if (existingKeys.has(key)) {
      result[key] = obj[key]
    }
  }

  return result
}

/**
 * Stringify JavaScript object to YAML
 * Configured to match our current js-yaml behavior
 */
export function stringify(obj: unknown, options?: StringifyOptions): string {
  // Apply key ordering if specified and obj is an object
  let orderedObj = obj
  if (options?.keyOrder && obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    orderedObj = reorderKeys(obj as Record<string, unknown>, options.keyOrder)
  }

  // Configure yaml to match js-yaml behavior
  const doc = new YAML.Document(orderedObj, {
    version: '1.2',
  })

  // Configure string options to match js-yaml
  const stringifyOptions: YAML.ToStringOptions = {
    lineWidth: options?.lineWidth === -1 ? 0 : (options?.lineWidth ?? 0), // 0 disables line wrapping
    nullStr: '', // Empty string for null values
  }

  // Handle special scalar types to match js-yaml behavior
  YAML.visit(doc, {
    Scalar(key, node, path) {
      if (typeof node.value === 'string') {
        // Quote numeric strings
        if (/^\d+$/.test(node.value)) {
          node.type = YAML.Scalar.QUOTE_DOUBLE
        }
      }
    },
  })

  let str = doc.toString(stringifyOptions)

  // Remove trailing newline to match js-yaml behavior
  str = str.trimEnd()

  // Match our current behavior: remove space after colon for null values
  str = str.replace(/: \n/g, ':\n')

  return str
}

// Default export for backward compatibility
export default stringify

// learned that date / time objects in YAML or UTC...
//    https://yaml.org/type/timestamp.html
// so serializing my dates to YYYY-MM-DD is futile since
// all yaml parsers would interpret the time as UTC
// best to serialize as a string, even though I think it's kinda ugly
