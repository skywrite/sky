import { assert, test } from '#test'
import { assertAccountAmbiguity, commandArgs, withGmail } from '../lib/testGmail.ts'
import DraftNew from './new.ts'

test('google:email:draft:new returns the draft id for subsequent edits', async () => {
  const requests: string[] = []
  await withGmail(
    (url, init) => {
      requests.push(`${init?.method ?? 'GET'} ${url.pathname}`)
      return { id: 'draft-1', message: { id: 'a1', threadId: 'ff' } }
    },
    async (context) => {
      const result = await new DraftNew().run(
        commandArgs(context, {
          body: 'Hello Jane',
          to: 'jane@example.com',
          subject: 'Atlas kickoff',
          noOpen: true,
          cc: undefined,
          bcc: undefined,
          account: undefined,
        }),
      )
      assert({
        given: 'a successful draft creation',
        should: 'expose the draft id while keeping the only write at drafts.create',
        expected: [true, 'draft-1', ['POST /gmail/v1/users/me/drafts']],
        actual: [result.ok, result.data?.draftId, requests],
      })
    },
  )
})

test('google:email:draft:new fails on ambiguous accounts outside a top-level console', async () => {
  await assertAccountAmbiguity((context) =>
    new DraftNew().run(
      commandArgs(context, {
        body: 'Hello Jane',
        noOpen: true,
        to: undefined,
        cc: undefined,
        bcc: undefined,
        subject: undefined,
        account: undefined,
      }),
    ),
  )
})
