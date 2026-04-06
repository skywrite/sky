import { assert, test } from '#test'
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
