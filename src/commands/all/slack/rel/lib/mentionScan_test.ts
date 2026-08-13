import { candidatesFromPaths } from '#lib/notebook/enrich/resolve.ts'
import { assert, test } from '#test'
import { scanMentions } from './mentionScan.ts'

const CANDIDATES = candidatesFromPaths([
  'people/2024/ja/Jane-Doe.md',
  'orgs/Acme-Corp.md',
  'projects/open/Atlas-Rollout/notes.md',
])

test('scanMentions finds normalized full names with word boundaries', () => {
  const hits = scanMentions('We should loop in Jane Doe about the Atlas rollout timeline.', CANDIDATES, [])
  assert({ given: 'a person named in text', should: 'match', actual: hits.includes('Jane Doe'), expected: true })
  assert({
    given: 'a project named informally',
    should: 'match via normalization',
    actual: hits.includes('projects/Atlas-Rollout'),
    expected: true,
  })
})

test('scanMentions requires whole-name presence', () => {
  const hits = scanMentions('Janet is doing fine and Acme Corporation called.', CANDIDATES, [])
  assert({
    given: 'a superstring of a name',
    should: 'not match Jane Doe',
    actual: hits.includes('Jane Doe'),
    expected: false,
  })
  assert({
    given: 'a different org form',
    should: 'not match Acme Corp',
    actual: hits.includes('Acme Corp'),
    expected: false,
  })
})

test('scanMentions excludes conversation parties', () => {
  const hits = scanMentions('Jane Doe shared the numbers.', CANDIDATES, ['Jane Doe'])
  assert({ given: 'the mention is a party', should: 'be excluded', actual: hits.includes('Jane Doe'), expected: false })
})
