import { assert, test } from '#test'
import { acceptSuggestedReviews } from './acceptReviews.ts'

test('explicit accept-all records suggestions and leaves unresolved issues unchanged', () => {
  assert({
    given: 'one suggested spelling and one unresolved word',
    should: 'accept only the actual suggestion, with the same recorded answers as manual review',
    actual: acceptSuggestedReviews([
      { originalText: 'Atlass', suggestedFix: 'Atlas', occurrences: 2 },
      { originalText: 'unclear phrase', occurrences: 1 },
    ]),
    expected: [
      { issueIndex: 0, originalText: 'Atlass', correction: 'Atlas', occurrences: 2, action: 'accept' },
      { issueIndex: 1, originalText: 'unclear phrase', correction: '', occurrences: 1, action: 'skip' },
    ],
  })
})
