import type { GmailMessage } from '#lib/google/gmail.ts'
import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { type GmailInboxClient, scanGmailInbox } from './gmailInbox.ts'

function mockGmailMessage(
  overrides: Partial<GmailMessage> & { id: string; threadId: string; isoDate: string },
): GmailMessage {
  const { isoDate, ...rest } = overrides
  const epochMs = Instant.from(isoDate).epochMilliseconds
  return {
    // External Gmail API boundary carries Date objects; test helper uses epoch ms from Temporal Instant.
    date: { getTime: () => epochMs } as unknown as GmailMessage['date'],
    labelIds: ['INBOX'],
    attachments: [],
    ...rest,
  }
}

test('scanGmailInbox scans unlabeled inbox threads, filters noise, caches by historyId, and auto-clears replies', async () => {
  const now = Instant.from('2025-03-15T16:00:00Z')
  const getThreadCalls: string[] = []
  let t1History = 'h100'
  let t1Replied = false
  let t1Archived = false

  const client: GmailInboxClient = {
    listAccounts: async () => ['sam@example.com'],
    listThreads: async () => [
      ...(!t1Archived ? [{ id: 't1', historyId: t1History, snippet: 'Can we move Thursday?' }] : []),
      { id: 't2', historyId: 'h200', snippet: 'Your receipt is ready' },
      { id: 't3', historyId: 'h300', snippet: 'Cold pitch from stranger' },
      { id: 't4', historyId: 'h400', snippet: 'Thanks for replying earlier' },
    ],
    getThread: async (_account, threadId, format) => {
      getThreadCalls.push(`${threadId}:${format}`)
      if (threadId === 't1') {
        const msgs = [
          mockGmailMessage({
            id: 'm1',
            threadId: 't1',
            isoDate: '2025-03-14T15:00:00Z',
            subject: 'Atlas board deck',
            from: { name: 'Jane Doe', address: 'jane@example.com' },
            bodyText: 'Can you review slide 4 before tomorrow?',
          }),
        ]
        if (t1Replied) {
          msgs.push(
            mockGmailMessage({
              id: 'm1b',
              threadId: 't1',
              isoDate: '2025-03-15T15:00:00Z',
              subject: 'Re: Atlas board deck',
              from: { name: 'Sam Owner', address: 'sam@example.com' },
              labelIds: ['INBOX', 'SENT'],
              bodyText: 'Looks great, approved.',
            }),
          )
        }
        return msgs
      }
      if (threadId === 't2') {
        return [
          mockGmailMessage({
            id: 'm2',
            threadId: 't2',
            isoDate: '2025-03-15T10:00:00Z',
            subject: 'Monthly receipt',
            from: { name: 'Billing', address: 'no-reply@billing.example.com' },
          }),
        ]
      }
      if (threadId === 't3') {
        return [
          mockGmailMessage({
            id: 'm3',
            threadId: 't3',
            isoDate: '2025-03-15T11:00:00Z',
            subject: 'Quick intro',
            from: { name: 'Unknown Cold Sender', address: 'stranger@cold.example.com' },
          }),
        ]
      }
      // t4: unknown sender, BUT owner already participated in the thread -> kept!
      return [
        mockGmailMessage({
          id: 'm4a',
          threadId: 't4',
          isoDate: '2025-03-14T10:00:00Z',
          subject: 'Venue contract',
          from: { name: 'Sam Owner', address: 'sam@example.com' },
          labelIds: ['SENT'],
          bodyText: 'Please send the updated terms.',
        }),
        mockGmailMessage({
          id: 'm4b',
          threadId: 't4',
          isoDate: '2025-03-15T12:00:00Z',
          subject: 'Re: Venue contract',
          from: { name: 'New Vendor', address: 'vendor@venue.example.com' },
          bodyText: 'Attached — can you confirm the headcount?',
        }),
      ]
    },
  }

  const scoreLookup = (name: string) => (name.toLowerCase() === 'jane doe' ? 300 : 0)

  const pass1 = await scanGmailInbox({
    client,
    previousCache: {},
    now,
    timezone: 'UTC',
    ownerNames: ['Sam Owner'],
    ownerAddresses: ['sam@example.com'],
    senderLookup: { scoreLookup },
  })

  assert({
    given: 'four inbox threads (known contact, noreply, cold stranger, active vendor thread)',
    should: 'admit only the known contact and the thread the owner participated in, with Gmail deep links',
    actual: pass1.candidates.map((c) => ({
      id: c.id,
      sender: c.senderName,
      summary: c.summary,
      link: c.target?.medium === 'Email' ? c.target.link : null,
    })),
    expected: [
      {
        id: 'Email:sam@example.com:t1',
        sender: 'Jane Doe',
        summary: 'Atlas board deck',
        link: 'https://mail.google.com/mail/u/?authuser=sam%40example.com#all/t1',
      },
      {
        id: 'Email:sam@example.com:t4',
        sender: 'New Vendor',
        summary: 'Venue contract',
        link: 'https://mail.google.com/mail/u/?authuser=sam%40example.com#all/t4',
      },
    ],
  })

  // Pass 2: identical historyIds -> zero getThread calls!
  getThreadCalls.length = 0
  const pass2 = await scanGmailInbox({
    client,
    previousCache: pass1.nextCache,
    now,
    timezone: 'UTC',
    ownerNames: ['Sam Owner'],
    ownerAddresses: ['sam@example.com'],
    senderLookup: { scoreLookup },
  })

  assert({
    given: 'a second scan with unchanged thread historyIds',
    should: 'reuse cached inbox threads with zero getThread API calls',
    actual: [pass2.threadsChecked, getThreadCalls.length, pass2.candidates.length],
    expected: [0, 0, 2],
  })

  // Pass 3: owner replies to t1 (historyId bumps) -> t1 auto-clears!
  t1Replied = true
  t1History = 'h101'
  const pass3 = await scanGmailInbox({
    client,
    previousCache: pass2.nextCache,
    now,
    timezone: 'UTC',
    ownerNames: ['Sam Owner'],
    ownerAddresses: ['sam@example.com'],
    senderLookup: { scoreLookup },
  })

  assert({
    given: 'owner replies to t1 in Gmail',
    should: 're-check only t1 and auto-clear it from candidates',
    actual: [pass3.threadsChecked, pass3.candidates.map((c) => c.id)],
    expected: [1, ['Email:sam@example.com:t4']],
  })
})
