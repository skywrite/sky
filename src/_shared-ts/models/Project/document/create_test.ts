import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import ProjectDocument from './mod.ts'

test('ProjectDocument.create - creates new project', () => {
  const doc = ProjectDocument.create({ name: 'New-Project' })

  assert({
    given: 'create with name',
    should: 'set name',
    actual: doc.name,
    expected: 'New-Project',
  })

  assert({
    given: 'create with name',
    should: 'default to open status',
    actual: doc.status,
    expected: 'open',
  })

  assert({
    given: 'create with name',
    should: 'set created date',
    actual: doc.created !== undefined,
    expected: true,
  })

  assert({
    given: 'create with name',
    should: 'include name in template',
    actual: doc.markdown.includes('# New-Project'),
    expected: true,
  })
})

test('ProjectDocument.create - stamps created/updated from a provided date', () => {
  const doc = ProjectDocument.create({ name: 'Dated-Project', created: new PlainDate('2026-01-15') })

  assert({
    given: 'create with a notebook date',
    should: 'stamp created from it, not the wall clock',
    actual: doc.yaml['created'],
    expected: '2026-01-15',
  })

  assert({
    given: 'create with a notebook date',
    should: 'stamp updated from it too',
    actual: doc.yaml['updated'],
    expected: '2026-01-15',
  })
})

test('ProjectDocument.create - uses provided body instead of template', () => {
  const body = '# Custom Title\n\n## What is the project?\n\nA filled-in overview.'
  const doc = ProjectDocument.create({ name: 'Custom-Project', body })

  assert({
    given: 'create with body',
    should: 'use the body verbatim',
    actual: doc.markdown,
    expected: body,
  })

  assert({
    given: 'create with body',
    should: 'still set frontmatter name',
    actual: doc.name,
    expected: 'Custom-Project',
  })
})
