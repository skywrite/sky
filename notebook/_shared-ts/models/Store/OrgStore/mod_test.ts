import { assert, test } from '#test'
import OrgStore from './mod.ts'

// OrgStore.build() requires file system access, so we test with empty dirs
// and verify the store structure works correctly

test('OrgStore.build - empty directories returns empty store', async () => {
  const store = await OrgStore.build([])

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

test('OrgStore.find - returns undefined for unknown name', async () => {
  const store = await OrgStore.build([])

  assert({
    given: 'empty store',
    should: 'return undefined for any name',
    actual: store.find('Unknown Org'),
    expected: undefined,
  })
})

test('OrgStore.findBySlug - returns undefined for unknown slug', async () => {
  const store = await OrgStore.build([])

  assert({
    given: 'empty store',
    should: 'return undefined for any slug',
    actual: store.findBySlug('unknown-org'),
    expected: undefined,
  })
})

test('OrgStore.findByPath - returns undefined for unknown path', async () => {
  const store = await OrgStore.build([])

  assert({
    given: 'empty store',
    should: 'return undefined for any path',
    actual: store.findByPath('/some/path.md'),
    expected: undefined,
  })
})

test('OrgStore.getAll - returns empty collection for empty store', async () => {
  const store = await OrgStore.build([])

  assert({
    given: 'empty store',
    should: 'return empty collection',
    actual: store.getAll().isEmpty,
    expected: true,
  })
})
