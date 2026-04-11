import { assert, test } from '#test'
import ProjectDocument from './mod.ts'
import { fixtures } from './fixtures.ts'

test('ProjectDocument.fromMarkdown - parses basic project', () => {
  const doc = ProjectDocument.fromMarkdown(fixtures.basic)

  assert({
    given: 'a basic project markdown',
    should: 'parse name',
    actual: doc.name,
    expected: 'Test-Project',
  })

  assert({
    given: 'a basic project markdown',
    should: 'parse status',
    actual: doc.status,
    expected: 'open',
  })

  assert({
    given: 'a basic project markdown',
    should: 'parse created date',
    actual: doc.created?.toString(),
    expected: '2025-01-15',
  })
})

test('ProjectDocument.fromMarkdown - parses project with tags', () => {
  const doc = ProjectDocument.fromMarkdown(fixtures.withTags)

  assert({
    given: 'a project with tags',
    should: 'parse tags',
    actual: String(doc.tags),
    expected: 'Category/Subcategory',
  })

  assert({
    given: 'a project with updated date',
    should: 'parse updated date',
    actual: doc.updated?.toString(),
    expected: '2025-01-20',
  })
})

test('ProjectDocument.fromMarkdown - parses project with relationships', () => {
  const doc = ProjectDocument.fromMarkdown(fixtures.withRel)

  assert({
    given: 'a project with rel',
    should: 'have 3 relationships',
    actual: doc.rel.size,
    expected: 3,
  })

  assert({
    given: 'a project with rel',
    should: 'include person reference',
    actual: doc.rel.has('John Doe'),
    expected: true,
  })

  assert({
    given: 'a project with rel',
    should: 'include project reference',
    actual: doc.rel.has('projects/Other-Project'),
    expected: true,
  })
})

test('ProjectDocument.fromMarkdown - parses completed project', () => {
  const doc = ProjectDocument.fromMarkdown(fixtures.completed)

  assert({
    given: 'a completed project',
    should: 'have completed status',
    actual: doc.status,
    expected: 'completed',
  })

  assert({
    given: 'a completed project',
    should: 'have closedReason',
    actual: doc.closedReason,
    expected: 'Successfully delivered',
  })

  assert({
    given: 'a completed project',
    should: 'be closed',
    actual: doc.closed,
    expected: true,
  })

  assert({
    given: 'a completed project',
    should: 'not be open',
    actual: doc.open,
    expected: false,
  })
})

test('ProjectDocument.fromMarkdown - parses on-hold project', () => {
  const doc = ProjectDocument.fromMarkdown(fixtures.onHold)

  assert({
    given: 'an on-hold project',
    should: 'have hold status',
    actual: doc.status,
    expected: 'hold',
  })

  assert({
    given: 'an on-hold project',
    should: 'not be open',
    actual: doc.open,
    expected: false,
  })
})

test('ProjectDocument.fromMarkdown - handles minimal project', () => {
  const doc = ProjectDocument.fromMarkdown(fixtures.minimal)

  assert({
    given: 'a minimal project',
    should: 'parse name',
    actual: doc.name,
    expected: 'Minimal',
  })

  assert({
    given: 'a minimal project without status',
    should: 'default to open',
    actual: doc.status,
    expected: 'open',
  })

  assert({
    given: 'a minimal project without created',
    should: 'have undefined created',
    actual: doc.created,
    expected: undefined,
  })
})
