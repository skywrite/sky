import { spyOn } from 'bun:test'
import * as prompts from '@clack/prompts'
import transformTypedParamsArgs from '#commands/lib/transformTypedParamsArgs/mod.ts'
import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { addGmailAccount, commandArgs, mailboxOf, withGmail } from '../lib/testGmail.ts'
import InboxView from './view.ts'

test('google:email:inbox:view is read-only and distinguishes listed counts from label totals', async () => {
  const methods: string[] = []
  let totalsAvailable = true
  const totals = { threadsTotal: 80, messagesTotal: 125, threadsUnread: 7, messagesUnread: 9 }
  await withGmail(
    (url, init) => {
      methods.push(init?.method ?? 'GET')
      const path = url.pathname
      if (path.endsWith('/labels')) return { labels: [{ id: 'Label_7', name: 'Sky/Follow', type: 'user' }] }
      if (path.endsWith('/labels/Label_7')) {
        return totalsAvailable ? totals : new Response('{}', { status: 403 })
      }
      if (path.endsWith('/threads')) return { threads: [{ id: 'ff' }] }
      if (path.endsWith('/threads/ff'))
        return {
          messages: [
            { id: 'a1', threadId: 'ff', labelIds: ['Label_7'] },
            {
              id: 'a2',
              threadId: 'ff',
              labelIds: [],
              snippet: 'Latest reply',
              internalDate: String(Instant.from('2026-01-05T05:30:42.123-05:00').epochMilliseconds),
              payload: { headers: [{ name: 'From', value: 'Jane Doe <jane@example.com>' }] },
            },
          ],
        }
      return new Response('{}', { status: 400 })
    },
    async (context) => {
      const args = commandArgs(context, { label: 'Sky/Follow', limit: 1, account: undefined })
      const result = await new InboxView().run(args)
      assert({
        given: 'one listed thread with an unlabeled reply and larger label-wide totals',
        should: 'return the latest message metadata, its mailbox, and actual totals without changing labels',
        expected: {
          ok: true,
          count: 2,
          totals,
          threads: [
            {
              threadId: 'ff',
              account: 'jane@example.com',
              subject: '(no subject)',
              from: 'Jane Doe',
              date: '2026-01-05T10:30:42.123Z',
              snippet: 'Latest reply',
              messages: 2,
              saved: false,
            },
          ],
          accounts: [{ account: 'jane@example.com', threads: 1, count: 2, totals }],
          writes: [],
        },
        actual: {
          ok: result.ok,
          count: result.data?.count,
          totals: result.data?.totals,
          threads: result.data?.threads,
          accounts: result.data?.accounts,
          writes: methods.filter((method) => method !== 'GET'),
        },
      })
      totalsAvailable = false
      const unavailable = await new InboxView().run(args)
      assert({
        given: 'an unavailable label count endpoint',
        should: 'keep the listing usable and report unknown totals instead of zero',
        expected: [true, 2, null],
        actual: [unavailable.ok, unavailable.data?.count, unavailable.data?.totals],
      })
    },
  )
})

test('google:email:inbox:view accepts only positive whole-number limits', async () => {
  const params = InboxView.description.params!
  const valid = await transformTypedParamsArgs(params, { _: [], limit: '2' })
  const rejected: unknown[] = []
  for (const limit of [0, -1, 1.5, 'nope']) {
    try {
      await transformTypedParamsArgs(params, { _: [], limit })
    } catch {
      rejected.push(limit)
    }
  }
  assert({
    given: 'a numeric CLI string and zero, negative, fractional, or invalid limits',
    should: 'parse a positive integer and reject unusable Gmail page sizes',
    expected: [2, [0, -1, 1.5, 'nope']],
    actual: [valid.limit, rejected],
  })
})

/** Two mailboxes with one inbox thread each; `broken` names a mailbox Gmail refuses to serve. */
function twoInboxes(broken?: string) {
  const inbox = {
    'jane@example.com': {
      totals: { threadsTotal: 3, messagesTotal: 4, threadsUnread: 1, messagesUnread: 1 },
      // Gmail thread ids are hex
      thread: 'a1',
      subject: 'Atlas kickoff',
      from: 'Sam Rivera <sam@example.com>',
      time: '2026-01-05T10:00:00Z',
    },
    'bob@example.com': {
      totals: { threadsTotal: 2, messagesTotal: 2, threadsUnread: 0, messagesUnread: 0 },
      thread: 'b1',
      subject: 'Lunch on Friday',
      from: 'Alex Kim <alex@example.com>',
      time: '2026-01-06T10:00:00Z',
    },
  }
  return (url: URL, init?: RequestInit) => {
    const mailbox = mailboxOf(init) as keyof typeof inbox
    if (mailbox === broken) return new Response('{}', { status: 403 })
    const mine = inbox[mailbox]
    const path = url.pathname
    if (path.endsWith('/labels')) return { labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] }
    if (path.endsWith('/labels/INBOX')) return mine.totals
    if (path.endsWith('/threads')) return { threads: [{ id: mine.thread }] }
    if (path.endsWith(`/threads/${mine.thread}`))
      return {
        messages: [
          {
            id: `${mine.thread}-1`,
            threadId: mine.thread,
            labelIds: ['INBOX'],
            internalDate: String(Instant.from(mine.time).epochMilliseconds),
            payload: {
              headers: [
                { name: 'From', value: mine.from },
                { name: 'Subject', value: mine.subject },
              ],
            },
          },
        ],
      }
    return new Response('{}', { status: 400 })
  }
}

test('google:email:inbox:view lists every connected mailbox and says which one each thread is in', async () => {
  const select = spyOn(prompts, 'select').mockResolvedValue('jane@example.com')
  try {
    await withGmail(twoInboxes(), async (context) => {
      await addGmailAccount(context, 'bob@example.com')
      const all = await new InboxView().run(commandArgs(context, { label: 'INBOX', limit: 5, account: undefined }))
      assert({
        given: 'two connected mailboxes and no account named',
        should: 'list both newest first, mark each thread with its mailbox, and add the label totals up',
        expected: {
          ok: true,
          threads: [
            ['b1', 'bob@example.com', 'Lunch on Friday'],
            ['a1', 'jane@example.com', 'Atlas kickoff'],
          ],
          totals: { threadsTotal: 5, messagesTotal: 6, threadsUnread: 1, messagesUnread: 1 },
          accounts: [
            ['bob@example.com', 1, 2],
            ['jane@example.com', 1, 3],
          ],
          asked: 0,
        },
        actual: {
          ok: all.ok,
          threads: all.data?.threads.map((row) => [row.threadId, row.account, row.subject]),
          totals: all.data?.totals,
          accounts: all.data?.accounts.map((entry) => [entry.account, entry.threads, entry.totals?.threadsTotal]),
          asked: select.mock.calls.length,
        },
      })

      const one = await new InboxView().run(commandArgs(context, { label: 'INBOX', limit: 5, account: 'bob' }))
      assert({
        given: 'one account named',
        should: 'list that mailbox alone',
        expected: [['b1'], ['bob@example.com']],
        actual: [one.data?.threads.map((row) => row.threadId), one.data?.accounts.map((entry) => entry.account)],
      })
    })

    await withGmail(twoInboxes('bob@example.com'), async (context) => {
      await addGmailAccount(context, 'bob@example.com')
      const partial = await new InboxView().run(commandArgs(context, { label: 'INBOX', limit: 5, account: undefined }))
      const unread = partial.data?.accounts.find((entry) => entry.account === 'bob@example.com')
      assert({
        given: 'a mailbox Gmail refuses to serve next to one that works',
        should: 'still list the working mailbox, flag the other as unread, and leave the overall totals unknown',
        expected: [true, ['a1'], true, null],
        actual: [
          partial.ok,
          partial.data?.threads.map((row) => row.threadId),
          Boolean(unread?.error?.includes('403')),
          partial.data?.totals,
        ],
      })
    })
  } finally {
    select.mockRestore()
  }
})
