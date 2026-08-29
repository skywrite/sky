import { assert, test } from '#test'
import { mergeAttachments } from './attachment.ts'

test('mergeAttachments - prior entries first, additions once, keyed by file', () => {
  assert({
    given: 'a resumed file listing one attachment and a session that re-read it and read another',
    should: 'keep the prior entry (with its rel) first and add only the new file',
    actual: mergeAttachments(
      [{ file: '2026-01-20_Chat_Atlas-Brief.pdf', rel: ['projects/Atlas'] }],
      [
        { file: '2026-01-20_Chat_Atlas-Brief.pdf' },
        { file: '2026-01-27_Chat_Atlas-MSA.pdf' },
        { file: '2026-01-27_Chat_Atlas-MSA.pdf' },
      ],
    ),
    expected: [
      { file: '2026-01-20_Chat_Atlas-Brief.pdf', rel: ['projects/Atlas'] },
      { file: '2026-01-27_Chat_Atlas-MSA.pdf' },
    ],
  })

  assert({
    given: 'nothing on either side',
    should: 'return an empty list',
    actual: mergeAttachments(undefined, undefined),
    expected: [],
  })
})
