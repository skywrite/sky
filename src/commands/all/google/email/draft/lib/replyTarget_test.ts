import type { GmailMessage } from '#lib/google/mod.ts'
import { assert, test } from '#test'
import { pickReplyTarget } from './replyTarget.ts'

function message(over: Partial<GmailMessage>): GmailMessage {
  return { id: 'm', threadId: 't', labelIds: [], attachments: [], ...over }
}

const THREAD: GmailMessage[] = [
  message({
    id: '1',
    subject: 'Atlas kickoff',
    from: { name: 'Jane Doe', address: 'jane@example.com' },
    messageId: '<a@x>',
  }),
  message({ id: '2', subject: 'Re: Atlas kickoff', from: { address: 'me@example.com' }, messageId: '<b@x>' }),
  message({
    id: '3',
    subject: 'Re: Atlas kickoff',
    from: { name: 'Jane Doe', address: 'jane@example.com' },
    messageId: '<c@x>',
  }),
]

test('pickReplyTarget - replies to the newest message from someone else', () => {
  const target = pickReplyTarget(THREAD, 'me@example.com')
  assert({
    given: 'a thread ending with the other side',
    should: 'address them, keep Re: single, and chain the ids',
    actual: [target?.to[0]?.address, target?.subject, target?.inReplyTo, target?.references],
    expected: ['jane@example.com', 'Re: Atlas kickoff', '<c@x>', '<a@x> <b@x> <c@x>'],
  })
})

test('pickReplyTarget - the owner speaking last still gets a reply target', () => {
  const target = pickReplyTarget(THREAD.slice(0, 2), 'jane@example.com')
  assert({
    given: 'a thread whose newest message is our own',
    should: 'fall back to the newest message overall',
    actual: [target?.to[0]?.address, target?.inReplyTo],
    expected: ['me@example.com', '<b@x>'],
  })
})

test('pickReplyTarget - subject gains Re: exactly once', () => {
  const target = pickReplyTarget([THREAD[2]], 'me@example.com')
  assert({
    given: 'a subject already carrying Re:',
    should: 'not double it',
    actual: target?.subject,
    expected: 'Re: Atlas kickoff',
  })
})
