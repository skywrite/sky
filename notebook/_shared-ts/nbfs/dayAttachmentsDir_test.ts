import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayAttachmentsDir from './dayAttachmentsDir.ts'

test('dayAttachmentsDir creates correct path for PlainDate', () => {
  const day = new PlainDate('2025-08-27')

  const result = dayAttachmentsDir(day)

  assert({
    given: 'PlainDate 2025-08-27',
    should: 'create relative path with padded year/month/day',
    actual: result,
    expected: '2025/08/27',
  })
})

test('dayAttachmentsDir handles single digit month and day', () => {
  const day = new PlainDate('2025-01-05')

  const result = dayAttachmentsDir(day)

  assert({
    given: 'PlainDate with single digit month and day',
    should: 'pad month and day to 2 digits',
    actual: result,
    expected: '2025/01/05',
  })
})

test('dayAttachmentsDir is consistent with dayDir pattern', () => {
  const day = new PlainDate('2025-08-27')

  const result = dayAttachmentsDir(day)

  assert({
    given: 'dayAttachmentsDir result',
    should: 'return relative path without base directory',
    actual: result.startsWith('/'),
    expected: false,
  })

  assert({
    given: 'dayAttachmentsDir result',
    should: 'be joinable with base directory',
    actual: '/attachments/' + result,
    expected: '/attachments/2025/08/27',
  })
})
