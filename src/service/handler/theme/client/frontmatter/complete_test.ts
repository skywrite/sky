import { assert, test } from '#test'
import { serves } from './complete.ts'

test({ name: 'completions - an answer serves the search it answered, or one typed on from it' }, () => {
  assert({
    given: 'answers for "", "da" and "dave" against searches typed on, shortened, changed and cleared',
    should: 'serve the same, the extended and the shortened search; never a different or a wider one',
    actual: [
      serves('da', 'da'),
      serves('da', 'dave'),
      serves('dave', 'da'),
      serves('da', 'do'),
      serves('', 'd'),
      serves('', ''),
      serves('d', ''),
    ],
    expected: [true, true, true, false, false, true, false],
  })
})
