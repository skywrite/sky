import { freeStreakName } from '#lib/streaks/mod.ts'
import { assert, test } from '#test'

test('freeStreakName()', () => {
  assert({
    given: 'a name no streak has',
    should: 'keep it as it is',
    actual: freeStreakName('eat-clean', ['read-a-chapter']),
    expected: 'eat-clean',
  })
  assert({
    given: 'a name an active or archived streak already has',
    should: 'add the first free number, starting at 2',
    actual: [freeStreakName('eat-clean', ['eat-clean']), freeStreakName('eat-clean', ['eat-clean', 'eat-clean-2'])],
    expected: ['eat-clean-2', 'eat-clean-3'],
  })
  assert({
    given: 'a taken name that differs only by capitalization',
    should: 'count as taken, because the two files could not sit in one folder',
    actual: freeStreakName('Eat-Clean', ['eat-clean']),
    expected: 'Eat-Clean-2',
  })
})
