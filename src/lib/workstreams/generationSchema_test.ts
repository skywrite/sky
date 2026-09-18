import type { JSONSchema7 } from 'ai'
import { z } from 'zod'
import { assert, test } from '#test'
import { WorkstreamReviewSchema } from './ai.ts'
import { workstreamGenerationSchema } from './generationSchema.ts'

test('model grammars omit large size constraints while local validation and field structure stay exact', async () => {
  const validator = z.object({
    body: z.string().min(1).max(24000),
    options: z.array(z.enum(['small', 'large'])).max(2),
    maximum: z.number().max(10),
  })
  const schema = await workstreamGenerationSchema(validator).jsonSchema
  const properties = schema.properties as Record<string, Record<string, unknown>>
  assert({
    given: 'a model schema with large text bounds and a property named like a JSON Schema keyword',
    should: 'reduce grammar expansion without discarding fields, enums or local bounds',
    actual: [
      properties.body.maxLength,
      properties.options.maxItems,
      properties.maximum.type,
      (properties.options.items as { enum: string[] }).enum,
      validator.safeParse({ body: 'x', options: ['small', 'large', 'small'], maximum: 1 }).success,
    ],
    expected: [undefined, undefined, 'number', ['small', 'large'], false],
  })
})

test('strict provider schemas make optional fields nullable while preserving domain optionality and nulls', async () => {
  const validator = z.object({
    coordination: z
      .object({
        people: z.array(z.object({ name: z.string(), contact: z.string().optional() })).optional(),
        note: z.string().nullable().optional(),
      })
      .optional(),
    artifact: z
      .object({
        body: z
          .string()
          .min(1)
          .refine((body) => body.startsWith('# ')),
      })
      .nullable(),
  })
  const schema = workstreamGenerationSchema(validator)
  const wire = await schema.jsonSchema
  const coordination = wire.properties!.coordination as JSONSchema7
  const inner = coordination.anyOf![0] as JSONSchema7
  const value = { coordination: { people: [{ name: 'Jane Doe', contact: null }], note: null }, artifact: null }
  const result = await schema.validate!(value)
  const absent = await schema.validate!({ coordination: null, artifact: null })
  assert({
    given: 'a strict transport schema and nested optional fields represented as null',
    should: 'require all transport fields, restore optional omissions and retain legitimate nulls',
    actual: [
      wire.required,
      wire.additionalProperties,
      inner.required,
      inner.additionalProperties,
      result,
      absent,
      value.coordination.people[0]!.contact,
    ],
    expected: [
      ['coordination', 'artifact'],
      false,
      ['people', 'note'],
      false,
      { success: true, value: { coordination: { people: [{ name: 'Jane Doe' }], note: null }, artifact: null } },
      { success: true, value: { artifact: null } },
      null,
    ],
  })
  const invalid = await schema.validate!({ coordination: null, artifact: { body: '' } })
  const unrefined = await schema.validate!({ coordination: null, artifact: { body: 'Missing a heading.' } })
  assert({
    given: 'a required artifact with an empty body after provider-only constraints were relaxed',
    should: 'still fail the original local validation',
    actual: [invalid.success, unrefined.success],
    expected: [false, false],
  })
})

test('the complete review schema stays structural and strict at every nested object', async () => {
  const wire = await workstreamGenerationSchema(WorkstreamReviewSchema).jsonSchema
  const issues: string[] = []
  let objects = 0
  const inspect = (schema: JSONSchema7, path: string) => {
    if (schema.properties) {
      objects += 1
      if (schema.additionalProperties !== false) issues.push(`${path}: additional properties`)
      if (Object.keys(schema.properties).some((name) => !schema.required?.includes(name)))
        issues.push(`${path}: optional property`)
      for (const [name, child] of Object.entries(schema.properties)) {
        if (typeof child === 'object') inspect(child, `${path}.${name}`)
      }
    }
    for (const child of schema.anyOf ?? []) if (typeof child === 'object') inspect(child, `${path}.anyOf`)
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items))
      inspect(schema.items, `${path}[]`)
    if (schema.maxLength !== undefined || schema.maxItems !== undefined || schema.pattern !== undefined)
      issues.push(`${path}: local bound`)
  }
  inspect(wire, 'review')
  assert({
    given: 'the composite review shape, including optional decision policies, coordination and relationships',
    should: 'produce closed structural objects without compiled size constraints',
    actual: [issues, objects > 10],
    expected: [[], true],
  })
})
