import type { ZodObject, ZodRawShape } from 'zod'
import { parseCsvLine } from './parseCsvLine.ts'
import type { CsvParseOptions, CsvParseOptionsWithSchema, CsvParseResult, InferSchema } from './types.ts'

/**
 * Parse a CSV string into headers and records with Zod schema validation.
 *
 * @param text - Raw CSV string
 * @param options - Parse options with Zod schema
 * @returns Parsed result with header and typed records
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 *
 * const schema = z.object({
 *   name: z.string(),
 *   age: z.coerce.number(),
 * })
 *
 * const result = parseCsv(`name,age
 * Alice,30
 * Bob,25`, { schema })
 *
 * // result.records: { name: string, age: number }[]
 * ```
 */
export function parseCsv<T extends ZodRawShape>(
  text: string,
  options: CsvParseOptionsWithSchema<T>,
): CsvParseResult<InferSchema<T>>

/**
 * Parse a CSV string into headers and records.
 *
 * @param text - Raw CSV string
 * @param options - Parse options (hasHeader defaults to true)
 * @returns Parsed result with header and string records
 *
 * @example
 * ```ts
 * const csv = `name,age
 * Alice,30
 * Bob,25`
 *
 * const result = parseCsv(csv)
 * // result.header: ['name', 'age']
 * // result.records: [{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }]
 * ```
 */
export function parseCsv(text: string, options?: CsvParseOptions): CsvParseResult<Record<string, string>>

// Implementation
export function parseCsv<T extends ZodRawShape>(
  text: string,
  options?: CsvParseOptions | CsvParseOptionsWithSchema<T>,
): CsvParseResult<InferSchema<T>> | CsvParseResult<Record<string, string>> {
  const hasHeader = options?.hasHeader ?? true
  const schema = (options as CsvParseOptionsWithSchema<T>)?.schema as ZodObject<T> | undefined

  const trimmed = text.replace(/\r\n/g, '\n').trim()
  if (!trimmed) {
    return { header: [], records: [] }
  }

  const lines = trimmed.split('\n').map(parseCsvLine)

  if (!hasHeader) {
    // No header: use numeric string keys ('0', '1', '2', ...)
    const records = lines.map((fields, lineIndex) => {
      const record: Record<string, string> = {}
      fields.forEach((field, i) => {
        record[String(i)] = field
      })
      if (schema) {
        return schema.parse(record)
      }
      return record
    })
    return { header: [], records } as CsvParseResult<InferSchema<T>> | CsvParseResult<Record<string, string>>
  }

  const header = lines.shift() ?? []
  const records = lines.map((fields, lineIndex) => {
    const record: Record<string, string> = {}
    fields.forEach((field, i) => {
      if (header[i]) {
        record[header[i]] = field
      }
    })
    if (schema) {
      try {
        return schema.parse(record)
      } catch (error) {
        // Add line context to Zod errors
        const zodError = error as { message: string }
        throw new Error(`CSV parse error at line ${lineIndex + 2}: ${zodError.message}`)
      }
    }
    return record
  })

  return { header, records } as CsvParseResult<InferSchema<T>> | CsvParseResult<Record<string, string>>
}
