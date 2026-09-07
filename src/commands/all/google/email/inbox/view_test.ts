import transformTypedParamsArgs from '#commands/lib/transformTypedParamsArgs/mod.ts'
import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { assertAccountAmbiguity, commandArgs, withGmail } from '../lib/testGmail.ts'
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
        should: 'return the latest message metadata and actual totals without changing labels',
        expected: {
          ok: true,
          count: 2,
          totals,
          threads: [
            {
              threadId: 'ff',
              subject: '(no subject)',
              from: 'Jane Doe',
              date: '2026-01-05T10:30:42.123Z',
              snippet: 'Latest reply',
              messages: 2,
              saved: false,
            },
          ],
          writes: [],
        },
        actual: {
          ok: result.ok,
          count: result.data?.count,
          totals: result.data?.totals,
          threads: result.data?.threads,
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

test('google:email:inbox:view fails on ambiguous accounts outside a top-level console', async () => {
  await assertAccountAmbiguity((context) =>
    new InboxView().run(commandArgs(context, { label: 'INBOX', limit: 1, account: undefined })),
  )
})
