import { assert, test } from '#test'
import { contactNameSet, landsOnContact } from './contactNames.ts'

const KNOWN_PEOPLE = ['Tanisha Patel (42)', 'Sam Rivera (new)', 'atlas/tanisha (42)', 'Jo Li (3)'].join('\n')

test('contactNameSet()', () => {
  assert({
    given: 'the contact lines rendered into the analysis prompt',
    should: 'hold each full name and every token of three or more characters, without the handle',
    actual: [...contactNameSet(KNOWN_PEOPLE)].sort(),
    expected: ['jo li', 'patel', 'rivera', 'sam', 'sam rivera', 'tanisha', 'tanisha patel'].sort(),
  })
})

test('landsOnContact()', () => {
  const contacts = contactNameSet(KNOWN_PEOPLE)
  assert({
    given: 'a full contact name, a token of one, and the token in another case',
    should: 'land',
    actual: ['Tanisha Patel', 'Tanisha', 'RIVERA'].map((fix) => landsOnContact(fix, contacts)),
    expected: [true, true, true],
  })
  assert({
    given: 'an unknown name, a removal, and no fix',
    should: 'not land',
    actual: [landsOnContact('Novak', contacts), landsOnContact('', contacts), landsOnContact(null, contacts)],
    expected: [false, false, false],
  })
})
