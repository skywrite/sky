import { assert, test } from '#test'
import { parse } from 'graphql'
import { createResolvers, typeDefs } from './schema.ts'
import type { Store } from '../store.ts'

/**
 * Collect field names from every `type Query` / `extend type Query` block.
 */
function queryFieldNames(): string[] {
  const doc = parse(typeDefs)
  const fields: string[] = []
  for (const def of doc.definitions) {
    if ((def.kind === 'ObjectTypeDefinition' || def.kind === 'ObjectTypeExtension') && def.name.value === 'Query') {
      for (const field of def.fields ?? []) {
        fields.push(field.name.value)
      }
    }
  }
  return fields
}

test('every schema Query field has a service resolver', () => {
  // A Query field without a resolver returns null, which violates the
  // non-null list types ([Chat!]! etc.) and surfaces to clients as the
  // masked "Unexpected error." — exactly how the chats query broke ai:chat.
  const resolvers = createResolvers({} as Store, null)
  const missing = queryFieldNames().filter((name) => !(name in resolvers.Query))

  assert({
    given: 'the service GraphQL schema and its resolver map',
    should: 'define a resolver for every Query field',
    actual: missing,
    expected: [],
  })
})
