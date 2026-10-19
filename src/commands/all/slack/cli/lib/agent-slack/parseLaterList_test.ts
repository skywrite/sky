import { readTextFileSync } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import parseLaterList from './parseLaterList.ts'

const FIXTURE = new URL('./fixtures/agent-slack-later-list.json', import.meta.url).pathname

test('parseLaterList reads the fixture shape', () => {
  const parsed = parseLaterList(readTextFileSync(FIXTURE))
  assert({ given: 'the later list fixture', should: 'parse both items', actual: parsed?.items.length, expected: 2 })
  assert({
    given: 'a hydrated item',
    should: 'carry channel name and content',
    actual: parsed?.items[0].channel_name,
    expected: 'atlas-rollout',
  })
  assert({
    given: 'a saved thread reply',
    should: 'keep the message thread_ts',
    actual: parsed?.items[0].message?.thread_ts,
    expected: '1699990000.000050',
  })
  assert({
    given: 'the counts block',
    should: 'expose in_progress',
    actual: parsed?.counts.in_progress,
    expected: 2,
  })
  assert({
    given: 'an item without optional fields',
    should: 'still parse',
    actual: parsed?.items[1].date_saved,
    expected: 1700259200,
  })
})

test('parseLaterList rejects malformed output', () => {
  assert({ given: 'non-JSON output', should: 'return null', actual: parseLaterList('nope'), expected: null })
  assert({ given: 'a JSON array', should: 'return null', actual: parseLaterList('[]'), expected: null })
  assert({
    given: 'items missing required fields',
    should: 'drop them',
    actual: parseLaterList('{"items":[{"ts":"1.2"}]}')?.items.length,
    expected: 0,
  })
})

test('parseLaterList keeps the split counts and the to-do fields', () => {
  const parsed = parseLaterList(
    JSON.stringify({
      counts: { in_progress: 162, saved: 69, todo: 93, overdue: 2, total: 3853 },
      items: [{ channel_id: 'C0ATLAS', ts: '1.1', item_type: 'message', todo_state: 'to_do', date_due: 500 }],
    }),
  )
  assert({
    given: 'the counts agent-slack reports since the split',
    should: 'pass saved, todo and overdue through',
    actual: parsed?.counts,
    expected: { in_progress: 162, saved: 69, todo: 93, overdue: 2, total: 3853 },
  })
  assert({
    given: 'an item with its pile and reminder',
    should: 'keep todo_state and date_due',
    actual: [parsed?.items[0]?.todo_state, parsed?.items[0]?.date_due],
    expected: ['to_do', 500],
  })
})
