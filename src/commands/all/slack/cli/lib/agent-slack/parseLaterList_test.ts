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
