import { justBefore } from '#commands/all/slack/pull/lib/ts.ts'
import { assert, test } from '#test'
import { messageLink } from './links.ts'

test('a message link names the channel and message, and a reply its thread root too', () => {
  assert({
    given: 'a root message, a reply, and a workspace with a trailing slash',
    should: 'build archive links the capture takes',
    actual: [
      messageLink('https://atlas.slack.com', 'C0ATLAS0001', '1760000000.000100'),
      messageLink('https://atlas.slack.com/', 'C0ATLAS0001', '1760000100.000200', '1760000000.000100'),
      messageLink('https://atlas.slack.com', 'C0ATLAS0001', '1760000000.000100', '1760000000.000100'),
    ],
    expected: [
      'https://atlas.slack.com/archives/C0ATLAS0001/p1760000000000100',
      'https://atlas.slack.com/archives/C0ATLAS0001/p1760000100000200?thread_ts=1760000000.000100&cid=C0ATLAS0001',
      'https://atlas.slack.com/archives/C0ATLAS0001/p1760000000000100',
    ],
  })
})

test('justBefore steps one microsecond back, borrowing a second when it must', () => {
  assert({
    given: 'a ts with micros, one at zero micros, and one without micros',
    should: 'step back one microsecond',
    actual: [justBefore('1760000000.000100'), justBefore('1760000000.000000'), justBefore('1760000000')],
    expected: ['1760000000.000099', '1759999999.999999', '1759999999.999999'],
  })
})
