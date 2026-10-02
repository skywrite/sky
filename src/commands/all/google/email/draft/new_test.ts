import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import { assert, test } from '#test'
import { addGmailAccount, assertAccountAmbiguity, commandArgs, withGmail } from '../lib/testGmail.ts'
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

test('google:email:draft:new asks with the real From, and never asks for a draft it could not write', async () => {
  await withGmail(
    () => new Response('{}', { status: 400 }),
    async (context) => {
      const card = async (input: Record<string, unknown>) => {
        const output = new BufferedOutput()
        await DraftNew.formatApproval(input, output, context)
        return output.getLogs().find((line) => line.includes('From:'))
      }
      const draft = { body: 'Hello Sam', to: 'sam@example.com' }
      assert({
        given: 'one connected mailbox',
        should: 'ask, and name that mailbox on the card instead of "(default)"',
        expected: [true, '  From:    jane@example.com'],
        actual: [await DraftNew.needsApprovalFor(draft, context), await card(draft)],
      })

      await addGmailAccount(context, 'bob@example.com')
      assert({
        given: 'two work mailboxes and no account named, so the run would stop at the account question',
        should: 'need no go for a call that writes nothing',
        expected: false,
        actual: await DraftNew.needsApprovalFor(draft, context),
      })
      assert({
        given: 'the same two mailboxes with one named, and a host that passes no context',
        should: 'ask, with the named mailbox as From',
        expected: [true, '  From:    bob@example.com', true],
        actual: [
          await DraftNew.needsApprovalFor({ ...draft, account: 'bob' }, context),
          await card({ ...draft, account: 'bob' }),
          await DraftNew.needsApprovalFor(draft),
        ],
      })
    },
  )
})
