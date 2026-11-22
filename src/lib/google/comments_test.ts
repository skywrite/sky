import { assert, test } from '#test'
import { compactComments } from './comments.ts'

test('compactComments', () => {
  const longContent = 'x'.repeat(4020)

  assert({
    given: 'raw Drive comments including both anchored and file-level threads',
    should:
      'preserve full review text up to 4000 chars, expose anchored: true on UI-anchored comments, and count replies',
    expected: [
      {
        id: 'c1',
        author: 'Jane Doe',
        created: '2026-07-29T09:00:00Z',
        content: 'Slide 3: the chart label is unreadable',
        quoted: 'Q3 spend',
        anchored: true,
        replyCount: 2,
      },
      {
        id: 'c2',
        author: 'Sky (me)',
        created: undefined,
        content: `${'x'.repeat(4000)}…`,
        replyCount: 0,
        resolved: true,
      },
    ],
    actual: compactComments([
      {
        id: 'c1',
        anchor: 'kix.anchor123',
        content: 'Slide 3: the chart label is unreadable',
        author: { displayName: 'Jane Doe' },
        createdTime: '2026-07-29T09:00:00Z',
        quotedFileContent: { value: 'Q3 spend' },
        replies: [{ content: 'agreed' }, { content: 'fixed' }],
      },
      {
        id: 'c2',
        content: longContent,
        author: { displayName: 'Sky', me: true },
        resolved: true,
      },
    ]),
  })
})
