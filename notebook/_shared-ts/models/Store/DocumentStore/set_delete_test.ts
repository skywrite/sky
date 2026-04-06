import { assert, test } from '#test'
import DocumentStore from './mod.ts'

test('DocumentStore.set: adds a document by path', async () => {
  const store = await DocumentStore.build([])
  const contents = '---\ntitle: Hello\n---\n\n# Hello World'

  store.set('/docs/hello.md', contents)

  assert({
    given: 'set with path and contents',
    should: 'increase size to 1',
    actual: store.size,
    expected: 1,
  })

  const doc = store.findByPath('/docs/hello.md')
  assert({
    given: 'set with path and contents',
    should: 'find by path',
    actual: doc?.yaml['title'],
    expected: 'Hello',
  })
})

test('DocumentStore.set: upserts existing document', async () => {
  const store = await DocumentStore.build([])

  store.set('/docs/hello.md', '---\ntitle: V1\n---\n\n# V1')
  store.set('/docs/hello.md', '---\ntitle: V2\n---\n\n# V2')

  assert({
    given: 'set same path twice',
    should: 'still have size 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'set same path twice',
    should: 'return updated document',
    actual: store.findByPath('/docs/hello.md')?.yaml['title'],
    expected: 'V2',
  })
})

test('DocumentStore.delete: removes a document', async () => {
  const store = await DocumentStore.build([])

  store.set('/docs/hello.md', '---\ntitle: Hello\n---\n\n# Hello')
  store.delete('/docs/hello.md')

  assert({
    given: 'delete after set',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'delete after set',
    should: 'return undefined for findByPath',
    actual: store.findByPath('/docs/hello.md'),
    expected: undefined,
  })
})

test('DocumentStore.delete: no-op for unknown path', async () => {
  const store = await DocumentStore.build([])

  store.delete('/docs/nonexistent.md')

  assert({
    given: 'delete unknown path',
    should: 'still have size 0',
    actual: store.size,
    expected: 0,
  })
})
