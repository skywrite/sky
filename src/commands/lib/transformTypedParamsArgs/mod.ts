/**
 * Transform CLI args using the new params-based format with Zod validation.
 *
 * This is the replacement for transformArgs.ts when using the new params system.
 */

import colors from 'picocolors'
import type { Args } from '#commands/lib/commands.d.ts'
import type { ParamDef, ParamsRecord } from '../params.ts'

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, (letter) => `-${letter.toLowerCase()}`)
}

/**
 * Check if a value is a primitive that needs parsing.
 * Objects are assumed to already be in their final form (from parent tasks).
 */
function needsParsing(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number'
}

export interface TransformTypedParamsArgsOptions {
  /**
   * The current task composition depth.
   * When > 0, unknown flag warnings are suppressed since the args
   * may come from parent tasks and aren't relevant to the child.
   * @default 0
   */
  compositionDepth?: number
}

/**
 * Transform raw CLI args using params definitions.
 *
 * Supports async default and parse functions.
 *
 * @param params - The params record from CommandDescription
 * @param rawArgs - Raw CLI args from std/flags parser
 * @param options - Optional settings for the transformation
 * @returns Transformed and validated args
 */
export default async function transformTypedParamsArgs(
  params: ParamsRecord,
  rawArgs: Args,
  options: TransformTypedParamsArgsOptions = {},
): Promise<Record<string, unknown>> {
  const { compositionDepth = 0 } = options
  const result: Record<string, unknown> = {}

  // Get positional args (everything after task name)
  const positionalArgs = [...rawArgs._].slice(1) as (string | number)[]

  // Collect all arg params sorted by position
  const argParams: Array<[string, ParamDef]> = []
  const flagParams: Array<[string, ParamDef]> = []

  for (const [name, param] of Object.entries(params)) {
    if (param.kind === 'arg') {
      argParams.push([name, param])
    } else if (param.kind === 'flag') {
      flagParams.push([name, param])
    } else if (param.kind === 'arg-or-flag') {
      // Can be either - check if we have a flag value first, then positional
      flagParams.push([name, param])
      argParams.push([name, param])
    }
  }

  // Sort arg params by position (default 0)
  argParams.sort((a, b) => (a[1].position ?? 0) - (b[1].position ?? 0))

  // Process positional args
  const processedArgNames = new Set<string>()
  for (let i = 0; i < argParams.length && i < positionalArgs.length; i++) {
    const [name, param] = argParams[i]
    if (processedArgNames.has(name)) continue // Already processed (arg-or-flag)

    const rawValue = positionalArgs[i]
    result[name] = await processValue(rawValue, param)
    processedArgNames.add(name)
  }

  // Fallback: resolve Arg params from named keys (tasks.run composition).
  // When a parent task calls tasks.run('child', { file: '/path' }), the Arg
  // param arrives as a named key rather than in the _ array. Positional values
  // from _ take precedence (already processed above).
  for (const [name, param] of argParams) {
    if (processedArgNames.has(name)) continue
    const named = rawArgs[name]
    if (named !== undefined) {
      result[name] = await processValue(named, param)
      processedArgNames.add(name)
    }
  }

  // Process flags
  const rawArgsCopy: Record<string, unknown> = { ...rawArgs }
  delete rawArgsCopy._

  // Convert kebab-case to camelCase
  const flagValues: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rawArgsCopy)) {
    flagValues[kebabToCamel(key)] = value
  }

  // Track defined flag names for warning about unknown flags
  const definedFlagNames = new Set<string>()

  for (const [name, param] of flagParams) {
    definedFlagNames.add(name)
    if (param.short) {
      definedFlagNames.add(param.short)
    }

    // Check both camelCase name and short name
    let rawValue: unknown = flagValues[name]
    if (rawValue === undefined && param.short) {
      rawValue = flagValues[param.short]
    }

    // Also check kebab-case version
    if (rawValue === undefined) {
      rawValue = flagValues[camelToKebab(name)]
    }

    // Reject duplicate flags (mri turns repeated --flag into an array)
    // TODO: support an 'array' param type (e.g. Flag.array('...')) that accepts
    // repeated flags like --tag="a" --tag="b" → ["a", "b"]
    if (Array.isArray(rawValue) && param.type !== 'boolean') {
      throw new Error(`Flag "--${camelToKebab(name)}" was specified multiple times`)
    }

    // For arg-or-flag, flag values override positional args
    // For regular flags, skip if already set by positional arg (shouldn't happen)
    if (rawValue !== undefined) {
      result[name] = await processValue(rawValue, param)
    }
  }

  // Apply defaults for missing values
  for (const [name, param] of Object.entries(params)) {
    if (result[name] === undefined) {
      if (param.default !== undefined) {
        const defaultValue = typeof param.default === 'function' ? await param.default() : param.default
        result[name] = defaultValue
      } else if (!param.optional) {
        // Required but missing - will be caught by validation
      }
    }
  }

  // Validate with Zod schemas
  for (const [name, param] of Object.entries(params)) {
    const value = result[name]

    // Skip undefined optional params
    if (value === undefined && param.optional) continue

    // Skip undefined params with no default (will fail required check)
    if (value === undefined) continue

    // Validate with schema if present
    if (param.schema) {
      const parseResult = param.schema.safeParse(value)
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
        throw new Error(`Validation failed for "${name}": ${errors}`)
      }
      result[name] = parseResult.data
    }
  }

  // Check for required params
  for (const [name, param] of Object.entries(params)) {
    if (result[name] === undefined && !param.optional && param.default === undefined) {
      throw new Error(`Required parameter "${name}" is missing`)
    }
  }

  // Warn about unknown flags (only at top-level CLI calls, not during task composition)
  if (compositionDepth === 0) {
    for (const flagName of Object.keys(flagValues)) {
      if (!definedFlagNames.has(flagName)) {
        console.log(colors.yellow(`  ${flagName} is not a defined flag.`))
      }
    }
  }

  return result
}

/**
 * Process a single value - apply parse function if needed.
 */
async function processValue(rawValue: unknown, param: ParamDef): Promise<unknown> {
  // If parse function exists and value needs parsing
  if (param.parse && needsParsing(rawValue)) {
    return await param.parse(rawValue as string)
  }

  // Otherwise return raw value (Zod will coerce/validate later)
  return rawValue
}
