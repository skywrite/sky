import { assert, test } from '#test'
import DocumentStore from './mod.ts'

// DocumentStore.build() requires file system access, so we test with empty dirs
// and verify the store structure works correctly

test('DocumentStore.build - empty directories returns empty store', async () => {
  const store = await DocumentStore.build([])

  assert({
    given: 'empty directories',
    should: 'return store with size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'empty directories',
    should: 'return store with no paths',
    actual: store.paths.length,
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

test('DocumentStore.findByPath - returns undefined for unknown path', async () => {
  const store = await DocumentStore.build([])

  assert({
    given: 'empty store',
    should: 'return undefined for any path',
    actual: store.findByPath('/some/path.md'),
    expected: undefined,
  })
})

test('DocumentStore.getAll - returns empty collection for empty store', async () => {
  const store = await DocumentStore.build([])

  assert({
    given: 'empty store',
    should: 'return empty collection',
    actual: store.getAll().isEmpty,
    expected: true,
  })
})

test('DocumentStore.resolveRef - returns undefined for empty store', async () => {
  const store = await DocumentStore.build([])

  assert({
    given: 'empty store with YYYY-MM-DD ref',
    should: 'return undefined',
    actual: store.resolveRef('2025-01-15/meeting', {}),
    expected: undefined,
  })

  assert({
    given: 'empty store with MM-DD ref',
    should: 'return undefined',
    actual: store.resolveRef('01-15/meeting', { year: 2025 }),
    expected: undefined,
  })

  assert({
    given: 'empty store with DD ref',
    should: 'return undefined',
    actual: store.resolveRef('15/meeting', { year: 2025, month: 1 }),
    expected: undefined,
  })
})

test('DocumentStore.resolveRef - returns undefined when context missing', async () => {
  const store = await DocumentStore.build([])

  assert({
    given: 'MM-DD ref without year context',
    should: 'return undefined',
    actual: store.resolveRef('01-15/meeting', {}),
    expected: undefined,
  })

  assert({
    given: 'DD ref without year context',
    should: 'return undefined',
    actual: store.resolveRef('15/meeting', { month: 1 }),
    expected: undefined,
  })

  assert({
    given: 'DD ref without month context',
    should: 'return undefined',
    actual: store.resolveRef('15/meeting', { year: 2025 }),
    expected: undefined,
  })
})

test('DocumentStore.resolveRef - returns undefined for invalid refs', async () => {
  const store = await DocumentStore.build([])

  assert({
    given: 'invalid ref (no subpath)',
    should: 'return undefined',
    actual: store.resolveRef('2025-01-15', {}),
    expected: undefined,
  })

  assert({
    given: 'invalid ref (just text)',
    should: 'return undefined',
    actual: store.resolveRef('some random text', {}),
    expected: undefined,
  })

  assert({
    given: 'invalid ref (month out of range)',
    should: 'return undefined',
    actual: store.resolveRef('13-15/meeting', { year: 2025 }),
    expected: undefined,
  })

  assert({
    given: 'invalid ref (day out of range)',
    should: 'return undefined',
    actual: store.resolveRef('01-32/meeting', { year: 2025 }),
    expected: undefined,
  })
})
