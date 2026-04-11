import { assert, test } from '#test'
import MarkdownStore from '../mod.ts'

// Regression: null values in rel arrays caused "Cannot read properties of null"
test('MarkdownStore.resolve - handles null value gracefully', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  // @ts-expect-error - testing runtime null handling
  const ref = store.resolve(null)

  assert({
    given: 'null value',
    should: 'resolve as unresolved (not throw)',
    actual: ref.type,
    expected: 'unresolved',
  })

  assert({
    given: 'null value',
    should: 'have empty raw string',
    actual: ref.raw,
    expected: '',
  })
})

// Regression: undefined values in rel arrays
test('MarkdownStore.resolve - handles undefined value gracefully', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  // @ts-expect-error - testing runtime undefined handling
  const ref = store.resolve(undefined)

  assert({
    given: 'undefined value',
    should: 'resolve as unresolved (not throw)',
    actual: ref.type,
    expected: 'unresolved',
  })
})

// Regression: resolveAll with null/undefined in array
test('MarkdownStore.resolveAll - handles null/undefined in array gracefully', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  // @ts-expect-error - testing runtime null handling
  const refs = store.resolveAll(['https://example.com', null, undefined, 'Unknown'])

  assert({
    given: 'array with null and undefined',
    should: 'return array of same length',
    actual: refs.length,
    expected: 4,
  })

  assert({
    given: 'array with null',
    should: 'resolve null as unresolved',
    actual: refs[1].type,
    expected: 'unresolved',
  })

  assert({
    given: 'array with undefined',
    should: 'resolve undefined as unresolved',
    actual: refs[2].type,
    expected: 'unresolved',
  })
})
