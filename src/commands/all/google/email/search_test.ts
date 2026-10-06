import { assert, test } from '#test'
import { addGmailAccount, commandArgs, mailboxOf, withGmail } from './lib/testGmail.ts'
import Search from './search.ts'

test('email search uses the query across connected mailboxes, including archived threads, without writes', async () => {
  const methods: string[] = []
  const queries: Array<[string, string | null, string[]]> = []
  await withGmail(
    (url, init) => {
      methods.push(init?.method ?? 'GET')
      const account = mailboxOf(init)
      if (url.pathname.endsWith('/threads')) {
        queries.push([account, url.searchParams.get('q'), url.searchParams.getAll('labelIds')])
        return { threads: [{ id: account === 'jane@example.com' ? 'aa' : 'bb' }] }
      }
      return {
        messages: [
          {
            id: 'a1',
            threadId: url.pathname.split('/').at(-1),
            labelIds: [],
            payload: {
              headers: [
                { name: 'Subject', value: 'Atlas review' },
                { name: 'From', value: 'Jane Doe <jane@example.com>' },
              ],
            },
          },
        ],
      }
    },
    async (context) => {
      await addGmailAccount(context, 'bob@example.com')
      const result = await new Search().run(
        commandArgs(context, { query: 'subject:Atlas', limit: 20, account: undefined }),
      )
      assert({
        given: 'related archived correspondence across two accounts',
        should: 'search beyond inbox labels and return readable thread ids with their accounts',
        actual: [
          result.ok,
          result.data?.complete,
          result.data?.threads.map((row) => [row.account, row.threadId]).sort(),
          queries.sort(),
          methods.every((method) => method === 'GET'),
        ],
        expected: [
          true,
          true,
          [
            ['bob@example.com', 'bb'],
            ['jane@example.com', 'aa'],
          ],
          [
            ['bob@example.com', 'subject:Atlas', []],
            ['jane@example.com', 'subject:Atlas', []],
          ],
          true,
        ],
      })
    },
  )
})

test('email search reports result limits and failed mailboxes without claiming full coverage', async () => {
  await withGmail(
    (url, init) => {
      if (mailboxOf(init) === 'bob@example.com') return new Response('{}', { status: 403 })
      if (url.pathname.endsWith('/threads')) return { threads: [{ id: 'aa' }, { id: 'bb' }] }
      return { messages: [{ id: 'a1', threadId: 'aa', payload: { headers: [] } }] }
    },
    async (context) => {
      await addGmailAccount(context, 'bob@example.com')
      const result = await new Search().run(commandArgs(context, { query: 'Atlas', limit: 1, account: undefined }))
      assert({
        given: 'one mailbox with extra matches and another with failed access',
        should: 'keep the successful match and expose both limits',
        actual: [
          result.ok,
          result.data?.complete,
          result.data?.threads.length,
          result.data?.accounts.find((row) => row.account === 'jane@example.com')?.hasMore,
          !!result.data?.accounts.find((row) => row.account === 'bob@example.com')?.error,
        ],
        expected: [true, false, 1, true, true],
      })
    },
  )
})
