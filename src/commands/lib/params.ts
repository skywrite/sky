/**
 * Type-safe task parameter builders with Zod validation.
 *
 * @example
 * ```typescript
 * import { Arg, ArgOrFlag, Flag } from '#commands/lib/params.ts'
 *
 * const params = {
 *   to:       ArgOrFlag.string('Channel or person', { short: 't' }),
 *   from:     Flag.string('Who from', { short: 'f' }),
 *   summary:  Flag.string('Summary', { optional: true }),
 *   when:     Flag.plainDateTime('When', { default: () => fetchNow().plainDateTime }),
 * }
 * ```
 */

import { z, type ZodType } from 'zod'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** The kind of parameter: positional arg, flag, or both */
export type ParamKind = 'arg' | 'flag' | 'arg-or-flag'

/** Supported parameter types */
export type ParamType = 'string' | 'number' | 'bool' | 'plainDate' | 'plainDateTime' | 'zonedDateTime'

/** JSON type for MCP schema generation */
export type ParamJsonType = 'string' | 'number' | 'boolean'

/** Options for defining a parameter */
export type ParamOptions<T> = {
  /** Short flag alias (e.g., 's' becomes '-s') */
  short?: string

  /**
   * Whether the param is optional (can be undefined).
   * - For Arg: defaults to false (required)
   * - For Flag: defaults to true (optional) - use `required: true` to override
   */
  optional?: boolean

  /** Whether the param is required (overrides optional for flags) */
  required?: boolean

  /** Default value - static value, sync fn, or async fn */
  default?: T | (() => T | Promise<T>)

  /** Transform raw string input - sync or async */
  parse?: (raw: string) => T | Promise<T>

  /** Zod schema for complex validation (overrides default schema) */
  schema?: ZodType<T>

  /** Hide from --help output */
  hidden?: boolean

  /** Completion source identifier */
  complete?: string

  /** Position for multiple positional args (default: 0) */
  position?: number
}

/** Definition of a parameter (what builders return) */
export interface ParamDef<T = unknown> {
  kind: ParamKind
  type: ParamType
  jsonType: ParamJsonType
  description: string
  optional?: boolean
  default?: T | (() => T | Promise<T>)
  parse?: (raw: string) => T | Promise<T>
  schema?: ZodType<T>
  short?: string
  position?: number
  hidden?: boolean
  complete?: string
}

/** Record of parameter definitions */
export type ParamsRecord = Record<string, ParamDef>

// -----------------------------------------------------------------------------
// Type Inference
// -----------------------------------------------------------------------------

/** Infer TypeScript type from a ParamDef */
type InferParamType<P extends ParamDef> =
  P extends ParamDef<infer T>
    ? P extends { optional: true } // Check if P has `optional: true` as a property
      ? T | undefined
      : T
    : never

/** Infer TypeScript types from a params record */
export type InferParams<P extends ParamsRecord> = {
  [K in keyof P]: InferParamType<P[K]>
}

// -----------------------------------------------------------------------------
// Zod Schemas
// -----------------------------------------------------------------------------

/** PlainDate Zod schema - handles both string input and existing instances */
const plainDateSchema: ZodType<PlainDate> = z.preprocess((val) => {
  if (val instanceof PlainDate) return val
  if (typeof val === 'string') return new PlainDate(val)
  return val
}, z.instanceof(PlainDate)) as ZodType<PlainDate>

/** PlainDateTime Zod schema - handles both string input and existing instances */
const plainDateTimeSchema: ZodType<PlainDateTime> = z.preprocess((val) => {
  if (val instanceof PlainDateTime) return val
  if (typeof val === 'string') return PlainDateTime.fromString(val)
  return val
}, z.instanceof(PlainDateTime)) as ZodType<PlainDateTime>

/** ZonedDateTime Zod schema - handles both string input and existing instances */
// String format: "datetime,timezone" (e.g., "2026-01-15 10:30,America/New_York")
const zonedDateTimeSchema: ZodType<ZonedDateTime> = z.preprocess((val) => {
  if (val instanceof ZonedDateTime) return val
  if (typeof val === 'string') {
    const commaIndex = val.lastIndexOf(',')
    if (commaIndex > 0) {
      const dateTime = val.slice(0, commaIndex)
      const timezone = val.slice(commaIndex + 1)
      return new ZonedDateTime(dateTime, timezone)
    }
    // No timezone specified - use system timezone
    return new ZonedDateTime(val)
  }
  return val
}, z.instanceof(ZonedDateTime)) as ZodType<ZonedDateTime>

// -----------------------------------------------------------------------------
// Builder Implementation
// -----------------------------------------------------------------------------

// For Arg: optional only if explicitly set or has default
type ArgOptional<T, O> = O extends { optional: true }
  ? ParamDef<T> & { optional: true }
  : O extends { default: unknown }
    ? ParamDef<T>
    : ParamDef<T>

// For Flag: optional by default, unless required: true or has default
type FlagOptional<T, O> = O extends { required: true }
  ? ParamDef<T>
  : O extends { default: unknown }
    ? ParamDef<T>
    : ParamDef<T> & { optional: true }

type BuilderReturn<T, O, K extends ParamKind> = K extends 'arg' ? ArgOptional<T, O> : FlagOptional<T, O>

function createBuilder<K extends ParamKind>(kind: K) {
  const isFlag = kind === 'flag' || kind === 'arg-or-flag'

  function buildParam<T, O extends ParamOptions<T>>(
    type: ParamType,
    jsonType: ParamJsonType,
    description: string,
    defaultSchema: ZodType<T>,
    options?: O,
  ): BuilderReturn<T, O, K> {
    // For flags: optional unless required:true or has default
    // For args: required unless optional:true or has default
    const hasDefault = options?.default !== undefined
    const isOptional = isFlag ? !options?.required && !hasDefault : options?.optional === true && !hasDefault

    return {
      kind,
      type,
      jsonType,
      description,
      schema: options?.schema ?? defaultSchema,
      ...options,
      optional: isOptional || undefined,
    } as BuilderReturn<T, O, K>
  }

  return {
    string<O extends ParamOptions<string> = ParamOptions<string>>(
      description: string,
      options?: O,
    ): BuilderReturn<string, O, K> {
      return buildParam('string', 'string', description, z.coerce.string(), options)
    },

    number<O extends ParamOptions<number> = ParamOptions<number>>(
      description: string,
      options?: O,
    ): BuilderReturn<number, O, K> {
      return buildParam('number', 'number', description, z.coerce.number(), options)
    },

    bool<O extends ParamOptions<boolean> = ParamOptions<boolean>>(
      description: string,
      options?: O,
    ): BuilderReturn<boolean, O, K> {
      return buildParam('bool', 'boolean', description, z.coerce.boolean(), options)
    },

    /** @deprecated Use `bool()` — kept so in-flight branches keep compiling until migrated. */
    boolean<O extends ParamOptions<boolean> = ParamOptions<boolean>>(
      description: string,
      options?: O,
    ): BuilderReturn<boolean, O, K> {
      return buildParam('bool', 'boolean', description, z.coerce.boolean(), options)
    },

    plainDate<O extends ParamOptions<PlainDate> = ParamOptions<PlainDate>>(
      description: string,
      options?: O,
    ): BuilderReturn<PlainDate, O, K> {
      return buildParam('plainDate', 'string', description, plainDateSchema, options)
    },

    plainDateTime<O extends ParamOptions<PlainDateTime> = ParamOptions<PlainDateTime>>(
      description: string,
      options?: O,
    ): BuilderReturn<PlainDateTime, O, K> {
      return buildParam('plainDateTime', 'string', description, plainDateTimeSchema, options)
    },

    zonedDateTime<O extends ParamOptions<ZonedDateTime> = ParamOptions<ZonedDateTime>>(
      description: string,
      options?: O,
    ): BuilderReturn<ZonedDateTime, O, K> {
      return buildParam('zonedDateTime', 'string', description, zonedDateTimeSchema, options)
    },
  }
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

/** Builder for positional arguments */
export const Arg = createBuilder('arg')

/** Builder for flags (--flag or -f) */
export const Flag = createBuilder('flag')

/** Builder for parameters that can be either positional arg or flag */
export const ArgOrFlag = createBuilder('arg-or-flag')
