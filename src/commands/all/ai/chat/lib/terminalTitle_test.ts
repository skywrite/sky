import { assert, test } from '#test'
import { titleSequence } from './terminalTitle.ts'

const OSC = '\u001b]0;'
const BEL = '\u0007'

test('titleSequence - wraps the title in OSC 0 and sanitizes it', () => {
  assert({
    given: 'a plain topic',
    should: 'wrap it in OSC 0 with a BEL terminator',
    actual: titleSequence('Fix Chat Summaries'),
    expected: `${OSC}Fix Chat Summaries${BEL}`,
  })
  assert({
    given: 'control characters that could break out of the sequence',
    should: 'replace them with spaces and trim',
    actual: titleSequence('Sneaky\nTitle'),
    expected: `${OSC}Sneaky Title${BEL}`,
  })
  assert({
    given: 'a title far past the tab-width cap',
    should: 'truncate to 80 characters',
    actual: titleSequence('x'.repeat(200)),
    expected: `${OSC}${'x'.repeat(80)}${BEL}`,
  })
})
