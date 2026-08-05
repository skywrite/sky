import { assert, test } from '#test'
import { fixtures } from './fixtures.ts'
import ProjectDocument from './mod.ts'

test('ProjectDocument.close - marks project as completed', () => {
  const doc = ProjectDocument.fromMarkdown(fixtures.basic)
  const closed = doc.close('completed', { reason: 'Done' })

  assert({
    given: 'closing a project as completed',
    should: 'set completed status',
    actual: closed.status,
    expected: 'completed',
  })

  assert({
    given: 'closing a project with reason',
    should: 'set closedReason',
    actual: closed.closedReason,
    expected: 'Done',
  })

  assert({
    given: 'closing a project',
    should: 'be closed',
    actual: closed.closed,
    expected: true,
  })

  assert({
    given: 'closing a project (immutable)',
    should: 'not modify original',
    actual: doc.status,
    expected: 'open',
  })
})

test('ProjectDocument.close - marks project as canceled', () => {
  const doc = ProjectDocument.fromMarkdown(fixtures.basic)
  const closed = doc.close('canceled')

  assert({
    given: 'canceling a project',
    should: 'set canceled status',
    actual: closed.status,
    expected: 'canceled',
  })
})
