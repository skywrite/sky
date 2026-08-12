import { assert, test } from '#test'
import { savedByCutoff } from './getInboxThreads.ts'

const CUTOFF = new Date('2026-08-10T10:15:00')

test('savedByCutoff counts the whole cutoff minute as saved', () => {
  assert({
    given: 'a message before the cutoff',
    should: 'count as saved',
    expected: true,
    actual: savedByCutoff(new Date('2026-08-10T09:00:00'), CUTOFF),
  })
  assert({
    given: 'a message 42s into the cutoff minute (the one that set lastActivity)',
    should: 'count as saved',
    expected: true,
    actual: savedByCutoff(new Date('2026-08-10T10:15:42'), CUTOFF),
  })
  assert({
    given: 'a message in the next minute',
    should: 'count as unsaved',
    expected: false,
    actual: savedByCutoff(new Date('2026-08-10T10:16:00'), CUTOFF),
  })
})
