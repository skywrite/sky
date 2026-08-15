import { assert, test } from '#test'
import MarkdownStore from './mod.ts'

// MarkdownStore.build() requires file system access, so we test with empty dirs
// and verify the resolution logic works correctly

test('MarkdownStore.build - empty directories returns valid store', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
    timeDirs: [],
  })

  assert({
    given: 'empty directories',
    should: 'have empty people store',
    actual: store.people.size,
    expected: 0,
  })

  assert({
    given: 'empty directories',
    should: 'have empty orgs store',
    actual: store.orgs.size,
    expected: 0,
  })

  assert({
    given: 'empty directories',
    should: 'have empty time store',
    actual: store.time.size,
    expected: 0,
  })
})

test('MarkdownStore.resolve - resolves URLs', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  const httpRef = store.resolve('http://example.com')
  assert({
    given: 'http URL',
    should: 'resolve as url type',
    actual: httpRef.type,
    expected: 'url',
  })

  assert({
    given: 'http URL',
    should: 'return URL object',
    actual: httpRef.type === 'url' && httpRef.value.href,
    expected: 'http://example.com/',
  })

  const httpsRef = store.resolve('https://example.com/path?query=1')
  assert({
    given: 'https URL with path and query',
    should: 'resolve as url type',
    actual: httpsRef.type,
    expected: 'url',
  })

  assert({
    given: 'https URL with path and query',
    should: 'preserve full URL',
    actual: httpsRef.type === 'url' && httpsRef.value.href,
    expected: 'https://example.com/path?query=1',
  })
})

test('MarkdownStore.resolve - returns unresolved for unknown strings', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  const ref = store.resolve('Unknown Person')

  assert({
    given: 'unknown string in empty store',
    should: 'resolve as unresolved type',
    actual: ref.type,
    expected: 'unresolved',
  })

  assert({
    given: 'unknown string in empty store',
    should: 'have null value',
    actual: ref.value,
    expected: null,
  })

  assert({
    given: 'unknown string in empty store',
    should: 'preserve raw string',
    actual: ref.raw,
    expected: 'Unknown Person',
  })
})

test('MarkdownStore.resolveAll - resolves multiple strings', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  const refs = store.resolveAll(['https://example.com', 'Unknown', 'http://test.com'])

  assert({
    given: 'array of strings',
    should: 'return array of same length',
    actual: refs.length,
    expected: 3,
  })

  assert({
    given: 'array with URL',
    should: 'resolve first as url',
    actual: refs[0].type,
    expected: 'url',
  })

  assert({
    given: 'array with unknown',
    should: 'resolve second as unresolved',
    actual: refs[1].type,
    expected: 'unresolved',
  })

  assert({
    given: 'array with URL',
    should: 'resolve third as url',
    actual: refs[2].type,
    expected: 'url',
  })
})

test('MarkdownStore.canResolve - returns correct boolean', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  assert({
    given: 'URL string',
    should: 'return true',
    actual: store.canResolve('https://example.com'),
    expected: true,
  })

  assert({
    given: 'unknown string',
    should: 'return false',
    actual: store.canResolve('Unknown Person'),
    expected: false,
  })
})

test('MarkdownStore.resolve - handles invalid URLs gracefully', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  // A string that looks like a URL but isn't valid
  const ref = store.resolve('http://')

  assert({
    given: 'invalid URL-like string',
    should: 'resolve as unresolved (not throw)',
    actual: ref.type,
    expected: 'unresolved',
  })
})

// =============================================================================
// Null Safety Regression Tests
// =============================================================================

test('MarkdownStore.resolve - handles null input', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  const ref = store.resolve(null as unknown as string)

  assert({
    given: 'null input',
    should: 'resolve as unresolved without throwing',
    actual: ref.type,
    expected: 'unresolved',
  })

  assert({
    given: 'null input',
    should: 'have empty raw string',
    actual: ref.raw,
    expected: '',
  })
})

test('MarkdownStore.resolve - handles undefined input', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  const ref = store.resolve(undefined as unknown as string)

  assert({
    given: 'undefined input',
    should: 'resolve as unresolved without throwing',
    actual: ref.type,
    expected: 'unresolved',
  })
})

test('MarkdownStore.resolve - handles number input', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  const ref = store.resolve(42 as unknown as string)

  assert({
    given: 'number input',
    should: 'resolve as unresolved without throwing',
    actual: ref.type,
    expected: 'unresolved',
  })

  assert({
    given: 'number input',
    should: 'convert to string for raw',
    actual: ref.raw,
    expected: '42',
  })
})

test('MarkdownStore.resolveAll - handles array with null values', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
  })

  // Simulate a rel array that contains null (can happen with malformed YAML)
  const refs = store.resolveAll(['https://example.com', null as unknown as string, 'Unknown Person'])

  assert({
    given: 'array with null value',
    should: 'return array of same length',
    actual: refs.length,
    expected: 3,
  })

  assert({
    given: 'array with null value',
    should: 'resolve first as url',
    actual: refs[0].type,
    expected: 'url',
  })

  assert({
    given: 'array with null value',
    should: 'resolve null as unresolved',
    actual: refs[1].type,
    expected: 'unresolved',
  })

  assert({
    given: 'array with null value',
    should: 'resolve third as unresolved',
    actual: refs[2].type,
    expected: 'unresolved',
  })
})

test('MarkdownStore.resolve - resolves library/ refs to documents', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
    libraryDir: '/nb/library',
  })

  store.set('/nb/library/books/Atlas-Field-Guide.md', '---\nsummary: Atlas Field Guide\n---\n\n# Atlas Field Guide')

  const ref = store.resolve('library/books/Atlas-Field-Guide')
  assert({
    given: 'a library ref without extension',
    should: 'resolve as document type',
    actual: ref.type,
    expected: 'document',
  })

  assert({
    given: 'a library ref without extension',
    should: 'resolve to the file path',
    actual: ref.type === 'document' ? ref.path : undefined,
    expected: '/nb/library/books/Atlas-Field-Guide.md',
  })

  const refWithExt = store.resolve('library/books/Atlas-Field-Guide.md')
  assert({
    given: 'a library ref with extension',
    should: 'resolve as document type',
    actual: refWithExt.type,
    expected: 'document',
  })
})

test('MarkdownStore.resolve - unknown library/ refs stay unresolved', async () => {
  const store = await MarkdownStore.build({
    peopleDirs: [],
    orgDirs: [],
    libraryDir: '/nb/library',
  })

  assert({
    given: 'a library ref with no matching file',
    should: 'resolve as unresolved',
    actual: store.resolve('library/books/Missing-Title').type,
    expected: 'unresolved',
  })
})
