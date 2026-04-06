import { assert, test } from '#test'
import DecisionStore from './mod.ts'

test('DecisionStore.set: adds a decision by path', () => {
  const store = DecisionStore.empty()
  const contents = '---\nname: hire-backend-lead\nsummary: Hire a backend lead\n---\n\n# Hire Backend Lead'

  store.set('/decisions/2026/03/hire-backend-lead.md', contents)

  assert({
    given: 'set with decision contents',
    should: 'increase size to 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'set with decision contents',
    should: 'find by name',
    actual: store.find('hire-backend-lead')?.value.name,
    expected: 'hire-backend-lead',
  })

  assert({
    given: 'set with decision contents',
    should: 'find by path',
    actual: store.findByPath('/decisions/2026/03/hire-backend-lead.md')?.name,
    expected: 'hire-backend-lead',
  })

  assert({
    given: 'pending decision',
    should: 'appear in pending list',
    actual: store.getPending().size,
    expected: 1,
  })
})

test('DecisionStore.set: upserts and cleans old indexes', () => {
  const store = DecisionStore.empty()
  const filePath = '/decisions/2026/03/hire-backend-lead.md'

  store.set(filePath, '---\nname: hire-backend-lead\n---\n\n# V1')
  store.set(filePath, '---\nname: hire-frontend-lead\n---\n\n# V2')

  assert({
    given: 'upsert with new name',
    should: 'still have size 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'upsert with new name',
    should: 'find by new name',
    actual: store.find('hire-frontend-lead')?.value.name,
    expected: 'hire-frontend-lead',
  })

  assert({
    given: 'upsert with new name',
    should: 'not find by old name',
    actual: store.find('hire-backend-lead'),
    expected: undefined,
  })
})

test('DecisionStore.delete: removes decision and all indexes', () => {
  const store = DecisionStore.empty()
  const filePath = '/decisions/2026/03/hire-backend-lead.md'

  store.set(filePath, '---\nname: hire-backend-lead\n---\n\n# Decision')
  store.delete(filePath)

  assert({
    given: 'delete after set',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'delete after set',
    should: 'not find by name',
    actual: store.find('hire-backend-lead'),
    expected: undefined,
  })

  assert({
    given: 'delete after set',
    should: 'not find by path',
    actual: store.findByPath(filePath),
    expected: undefined,
  })
})
