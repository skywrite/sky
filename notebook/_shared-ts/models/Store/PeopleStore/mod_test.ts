import { assert, test } from '#test'
import PeopleStore from './mod.ts'

// PeopleStore.build() requires file system access, so we test with empty dirs
// and verify the store structure works correctly

test('PeopleStore.build - empty directories returns empty store', async () => {
  const store = await PeopleStore.build([])

  assert({
    given: 'empty directories',
    should: 'return store with size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'empty directories',
    should: 'return store with no names',
    actual: store.names.length,
    expected: 0,
  })

  assert({
    given: 'empty directories',
    should: 'return store with no errors',
    actual: store.errors.length,
    expected: 0,
  })

  assert({
    given: 'empty directories',
    should: 'return store with no warnings',
    actual: store.warnings.length,
    expected: 0,
  })
})

test('PeopleStore.find - returns undefined for unknown name', async () => {
  const store = await PeopleStore.build([])

  assert({
    given: 'empty store',
    should: 'return undefined for any name',
    actual: store.find('Unknown Person'),
    expected: undefined,
  })
})

test('PeopleStore.findByPath - returns undefined for unknown path', async () => {
  const store = await PeopleStore.build([])

  assert({
    given: 'empty store',
    should: 'return undefined for any path',
    actual: store.findByPath('/some/path.md'),
    expected: undefined,
  })
})

test('PeopleStore.getAll - returns empty collection for empty store', async () => {
  const store = await PeopleStore.build([])

  assert({
    given: 'empty store',
    should: 'return empty collection',
    actual: store.getAll().isEmpty,
    expected: true,
  })
})
