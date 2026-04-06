import { assert, test } from '#test'
import baseNoExt from './baseNoExt.ts'

test(baseNoExt.name, () => {
  assert({
    given: 'a file with extension',
    should: 'remove the extension',
    expected: 'meeting',
    actual: baseNoExt('meeting.md'),
  })
})

test(baseNoExt.name, () => {
  assert({
    given: 'a file with extension',
    should: 'remove the extension',
    expected: 'meeting',
    actual: baseNoExt('/tmp/meeting.md'),
  })
})
