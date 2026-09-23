import type { Args, CommandDescription } from '#commands/lib/commands.d.ts'
import type { ParamDef } from '#commands/lib/params.ts'
import transformTypedParamsArgs from '#commands/lib/transformTypedParamsArgs/mod.ts'

/**
 * Working out the arguments a composed command actually receives.
 *
 * A command called by another inherits the caller's arguments, then has the
 * callee's own parameter schema applied to them — its `parse()` and
 * `default()` functions — before explicit overrides win. Precedence is:
 *
 *   command defaults  <  caller's args  <  explicit overrides
 */

export interface ResolveCommandArgsOptions {
  /** The callee's description, whose params drive parsing and defaults. */
  description: CommandDescription | undefined
  /** Arguments belonging to the calling scope. */
  callerArgs: Record<string, unknown>
  /** Explicit overrides from the call site. */
  overrides: Record<string, unknown> | undefined
  /** The caller's composition depth; the callee sits one deeper. */
  callerDepth: number
}

export async function resolveCommandArgs({
  description,
  callerArgs,
  overrides,
  callerDepth,
}: ResolveCommandArgsOptions): Promise<Record<string, unknown>> {
  const params = description?.params

  let transformed: Record<string, unknown>
  if (params) {
    // Overrides are included so required-param checks can see them; values that
    // are already parsed objects (a PlainDate, say) skip parsing via
    // needsParsing(). The incremented depth suppresses unknown-flag warnings,
    // which only make sense for arguments a person typed.
    const withOverrides: Args = { _: [], ...callerArgs, ...overrides }
    transformed = await transformTypedParamsArgs(params, withOverrides, {
      compositionDepth: callerDepth + 1,
    })
  } else {
    transformed = callerArgs
  }

  // Preserve already-normalized overrides from composing commands, including
  // strings whose custom parser would otherwise transform them a second time.
  const finalArgs = { ...transformed, ...overrides }

  for (const [name, def] of Object.entries(params ?? {}) as [string, ParamDef][]) {
    // A list's validated output is authoritative for strings, arrays and
    // defaults. Restoring an override here would undo parsing or validation.
    if (def.type === 'stringArray') {
      finalArgs[name] = transformed[name]
      continue
    }

    // Raw callers can encode dates, booleans and numbers as strings. Keep
    // their parsed values instead of restoring strings in the spread above.
    if (
      (def.type === 'plainDate' ||
        def.type === 'plainDateTime' ||
        def.type === 'zonedDateTime' ||
        def.type === 'bool' ||
        def.type === 'number') &&
      typeof overrides?.[name] === 'string'
    ) {
      finalArgs[name] = transformed[name]
    }

    // stringOrBool overrides are presence signals rather than parsed values,
    // so resolve the caller's `true` to the string the command expects.
    if (def.type === 'stringOrBool' && def.schema && name in finalArgs) {
      const resolved = def.schema.safeParse(finalArgs[name])
      if (resolved.success) finalArgs[name] = resolved.data
    }
  }

  return finalArgs
}
