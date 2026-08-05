import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

test('Document.ensureUpdated - sets updated to today when not present', () => {
  const doc = new Document({}, '# Test')
  const today = PlainDate.today().ymd

  const updated = doc.ensureUpdated()

  assert({ actual: updated.yaml['updated'], expected: today })
})

test('Document.ensureUpdated - updates existing updated field to today', () => {
  const oldDate = '2020-01-01'
  const doc = new Document({ updated: oldDate }, '# Test')
  const today = PlainDate.today().ymd

  const updated = doc.ensureUpdated()

  assert({ actual: updated.yaml['updated'], expected: today })
  assert({
    given: 'a document with old updated date',
    should: 'change to a different date',
    actual: updated.yaml['updated'] !== oldDate,
    expected: true,
  })
})

test('Document.ensureUpdated - does not modify created field', () => {
  const createdDate = '2020-01-01'
  const doc = new Document({ created: createdDate }, '# Test')

  const updated = doc.ensureUpdated()

  assert({ actual: updated.yaml['created'], expected: createdDate })
})

test('Document.ensureUpdated - does not add created field if missing', () => {
  const doc = new Document({}, '# Test')

  const updated = doc.ensureUpdated()

  assert({ actual: updated.yaml['created'], expected: undefined })
})

test('Document.ensureUpdated - preserves other YAML fields', () => {
  const doc = new Document({ title: 'Test', tags: 'foo, bar' }, '# Test')

  const updated = doc.ensureUpdated()

  assert({ actual: updated.yaml['title'], expected: 'Test' })
  assert({ actual: updated.yaml['tags'], expected: 'foo, bar' })
})

test('Document.ensureUpdated - returns new instance (immutable)', () => {
  const doc = new Document({ updated: '2020-01-01' }, '# Test')

  const updated = doc.ensureUpdated()

  assert({
    given: 'ensureUpdated result',
    should: 'return a different object reference',
    actual: updated !== doc,
    expected: true,
  })
  assert({
    given: 'the original document',
    should: 'preserve original updated date',
    actual: doc.yaml['updated'],
    expected: '2020-01-01',
  })
})
