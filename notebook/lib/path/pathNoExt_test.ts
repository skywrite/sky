import { assert, test } from '#test'
import pathNoExt from './pathNoExt.ts'

test(pathNoExt.name, () => {
  assert({
    given: 'a file with extension',
    should: 'remove the extension',
    expected: 'meeting',
    actual: pathNoExt('meeting.md'),
  })
})

test(pathNoExt.name, () => {
  assert({
    given: 'a file with extension',
    should: 'remove the extension',
    expected: '/tmp/meeting',
    actual: pathNoExt('/tmp/meeting.md'),
  })
})

test(pathNoExt.name, () => {
  assert({
    given: 'a file and directory with extension',
    should: 'remove the extension',
    expected: 'most-important/MI1',
    actual: pathNoExt('most-important/MI1.md'),
  })
})
