import { jsonSchema, type JSONSchema7, type Schema } from 'ai'
import { z } from 'zod'

const LOCAL_CONSTRAINTS = new Set([
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'pattern',
  'default',
])

/** Keep provider grammars structural; validate bounds and refinements locally before returning any result. */
export function workstreamGenerationSchema<T extends z.ZodType>(validator: T): Schema<z.output<T>> {
  const original = z.toJSONSchema(validator, { target: 'draft-07' }) as JSONSchema7
  const relax = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(relax)
    if (!value || typeof value !== 'object') return value
    const relaxed = Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !LOCAL_CONSTRAINTS.has(key))
        .map(([key, child]) => [
          key,
          ['properties', '$defs', 'definitions'].includes(key) && child && typeof child === 'object'
            ? Object.fromEntries(
                Object.entries(child).map(([property, specification]) => [property, relax(specification)]),
              )
            : relax(child),
        ]),
    )
    if (relaxed.properties) {
      // Strict structured output requires every property. Null represents an omitted optional field on the wire.
      const required = new Set(relaxed.required as string[] | undefined)
      const properties = Object.fromEntries(
        Object.entries(relaxed.properties).map(([name, specification]) => [
          name,
          required.has(name) ? specification : { anyOf: [specification, { type: 'null' }] },
        ]),
      )
      relaxed.properties = properties
      relaxed.required = Object.keys(properties)
      relaxed.additionalProperties = false
    }
    return relaxed
  }
  return jsonSchema<z.output<T>>(relax(original) as JSONSchema7, {
    validate: (value) => {
      const result = validator.safeParse(restoreOptionalFields(value, original))
      return result.success ? { success: true, value: result.data } : { success: false, error: result.error }
    },
  })
}

function permitsNull(schema: JSONSchema7): boolean {
  return (
    schema.type === 'null' ||
    (Array.isArray(schema.type) && schema.type.includes('null')) ||
    !!schema.anyOf?.some((branch) => typeof branch === 'object' && permitsNull(branch))
  )
}

function restoreOptionalFields(value: unknown, schema: JSONSchema7): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)
      ? value.map((item) => restoreOptionalFields(item, schema.items as JSONSchema7))
      : value
  }
  // Nullable objects keep their domain null; only absent optional properties become undefined again.
  const object = schema.properties
    ? schema
    : schema.anyOf?.find((branch): branch is JSONSchema7 => typeof branch === 'object' && !!branch.properties)
  if (!object?.properties) return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, child]) => {
      const specification = object.properties![name]
      if (!specification || typeof specification !== 'object') return [[name, child]]
      if (child === null && !object.required?.includes(name) && !permitsNull(specification)) return []
      return [[name, restoreOptionalFields(child, specification)]]
    }),
  )
}
