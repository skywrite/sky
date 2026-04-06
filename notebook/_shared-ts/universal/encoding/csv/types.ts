import type { z, ZodObject, ZodRawShape } from 'zod'

/**
 * Result of parsing a CSV string.
 */
export interface CsvParseResult<T = Record<string, string>> {
  /** Column headers (first row if hasHeader is true, empty if false) */
  readonly header: readonly string[]
  /** Parsed records */
  readonly records: readonly T[]
}

/**
 * Options for CSV parsing without schema (returns strings).
 */
export interface CsvParseOptions {
  /** Whether the first row contains column headers. Default: true */
  readonly hasHeader?: boolean
}

/**
 * Options for CSV parsing with Zod schema (returns typed records).
 */
export interface CsvParseOptionsWithSchema<T extends ZodRawShape> extends CsvParseOptions {
  /** Zod schema for validating and transforming records */
  readonly schema: ZodObject<T>
}

/**
 * Infer the record type from a Zod schema.
 */
export type InferSchema<T extends ZodRawShape> = z.infer<ZodObject<T>>
