import { assert, test } from '#test'
import { isFamily } from './familiarity.ts'

test('family means the Person/Family tag or a tag under it, never one that only looks like it', () => {
  assert({
    given: 'the family tag, a tag under it in any case, and lookalike or legacy tags',
    should: 'count only the Person/Family hierarchy',
    actual: [
      ['Person/Family'],
      ['Person/Family/Spouse'],
      ['person/family/son'],
      ['Person/FamilyFriends'],
      ['Person/Spouse'],
      ['Organization/Family'],
      [],
    ].map(isFamily),
    expected: [true, true, true, false, false, false, false],
  })
})
