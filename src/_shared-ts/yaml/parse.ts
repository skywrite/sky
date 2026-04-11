import * as YAML from 'yaml'

export interface ParseOptions {
  // Schema to use for parsing
  // 'failsafe' - everything as strings (prevents type coercion edge cases)
  // 'json' - JSON-compatible types
  // 'core' - YAML 1.2 core schema
  // 'yaml-1.1' - YAML 1.1 schema (default)
  schema?: 'failsafe' | 'json' | 'core' | 'yaml-1.1'
}

/**
 * Parse YAML string to JavaScript object
 *
 * GOOD NEWS: npm:yaml is safer than js-yaml out of the box!
 * - NO → stays as "NO" (not coerced to false) ✅
 * - yes/no/on/off → stay as strings (not coerced to booleans) ✅
 *
 * Current behavior with npm:yaml (default schema):
 * 1. ✅ Norwegian problem FIXED: "NO" stays as "NO" (js-yaml coerces to false)
 * 2. ✅ Boolean words safe: yes/no/on/off stay as strings (js-yaml coerces)
 * 3. ⚠️  Version strings: version: 1.0 → number 1.0
 * 4. ⚠️  Octal-like: 0777 → decimal 777 (leading zero stripped, NOT octal conversion)
 * 5. ⚠️  Scientific notation: 1e3 → number 1000
 * 6. ⚠️  Hex numbers: 0x1A → decimal 26
 * 7. ⚠️  Date-like strings: 2024-01-01 → stays as string (safe!)
 * 8. ⚠️  Null words: null/~ → null
 * 9. ✅ Only true/false coerce to booleans (not yes/no/on/off)
 *
 * See tests in edgecases_test.ts for documented examples
 * Reference: https://news.ycombinator.com/item?id=17359376 (Norwegian problem)
 *
 * TODO: Consider enabling failsafe schema to prevent ALL type coercion:
 * To enable: return YAML.parse(yamlStr, { schema: 'failsafe', ...options }) ?? {}
 * Note: This requires updating all code that expects typed values
 */
export function parse(yamlStr: string, options?: ParseOptions): unknown {
  if (!yamlStr || yamlStr.trim() === '') {
    return {}
  }

  try {
    // Using yaml for parsing
    // TODO: Add { schema: 'failsafe', ...options } to prevent type coercion edge cases
    return YAML.parse(yamlStr, options) ?? {}
  } catch (error) {
    console.error('YAML parse error:', error)
    return {}
  }
}

/**
 * Parse YAML string to JavaScript object with error information
 * Returns both the parsed data and any error that occurred
 *
 * TODO: Consider enabling failsafe schema (see parse() function for edge cases)
 */
export function parseWithError(yamlStr: string, options?: ParseOptions): { data: unknown; error?: string } {
  if (!yamlStr || yamlStr.trim() === '') {
    return { data: {} }
  }

  try {
    // Using yaml for parsing
    // TODO: Add { schema: 'failsafe', ...options } to prevent type coercion edge cases
    return { data: YAML.parse(yamlStr, options) ?? {} }
  } catch (error) {
    // Extract the most useful part of the error message
    let errorMessage = 'Unknown YAML parsing error'
    if (error instanceof Error && error.message) {
      // Take the first line of the error message which usually has the key info
      errorMessage = error.message.split('\n')[0]
    }
    console.error('YAML parse error:', error)
    return { data: {}, error: errorMessage }
  }
}
