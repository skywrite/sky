import { spyOn } from 'bun:test'
import { Buffer } from 'node:buffer'
import * as prompts from '@clack/prompts'
import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { addGmailAccount, commandArgs, mailboxOf, withGmail } from './lib/testGmail.ts'
import Read from './read.ts'

test('email attachments remain visible when older bodies are omitted, without exposing encoded bytes', async () => {
  await withGmail(
    () => ({
      messages: [
        {
          id: 'older',
          threadId: 'ff',
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              { mimeType: 'text/plain', body: { data: Buffer.from('See attached.').toString('base64url') } },
              {
                partId: '1',
                filename: 'Atlas.pdf',
                mimeType: 'application/pdf',
                body: { attachmentId: 'long-opaque-id', size: 25 },
              },
              {
                mimeType: 'multipart/related',
                parts: [
                  {
                    partId: '2.1',
                    filename: 'scan.png',
                    mimeType: 'image/png',
                    headers: [{ name: 'Content-Disposition', value: 'inline' }],
                    body: { data: 'AQID', size: 3 },
                  },
                ],
              },
            ],
          },
        },
        ...Array.from({ length: 7 }, (_, i) => ({
          id: `newer-${i}`,
          threadId: 'ff',
          payload: { mimeType: 'text/plain', body: { data: Buffer.from('x'.repeat(4000)).toString('base64url') } },
        })),
      ],
    }),
    async (context) => {
      const result = await new Read().run(
        commandArgs(context, { thread: 'ff', account: undefined, message: undefined, offset: undefined }),
      )
      const selected = await new Read().run(
        commandArgs(context, { thread: 'ff', account: undefined, message: 'newer-6', offset: undefined }),
      )
      assert({
        given: 'an omitted older message with nested attachments and inline bytes',
        should: 'return the complete attachment inventory separately from bounded bodies and honor message selection',
        actual: [
          result.data?.omittedMessageIds.includes('older'),
          result.data?.attachments,
          selected.data?.attachments,
        ],
        expected: [
          true,
          [
            {
              messageId: 'older',
              partId: '1',
              filename: 'Atlas.pdf',
              contentType: 'application/pdf',
              size: 25,
              inline: false,
            },
            {
              messageId: 'older',
              partId: '2.1',
              filename: 'scan.png',
              contentType: 'image/png',
              size: 3,
              inline: true,
            },
          ],
          [],
        ],
      })
    },
  )
})

test('google:email:read follows API continuations to the end of a long message', async () => {
  const body = 'Initial context. ' + 'a'.repeat(30000) + ' Final correction.'
  const requests: string[] = []
  await withGmail(
    (url, init) => {
      requests.push(`${init?.method ?? 'GET'} ${url.pathname}`)
      return {
        messages: [
          {
            id: 'a1',
            threadId: 'ff',
            payload: { mimeType: 'text/plain', headers: [], body: { data: Buffer.from(body).toString('base64url') } },
          },
        ],
      }
    },
    async (context) => {
      const args = {
        thread: 'ff',
        account: undefined,
        message: undefined as string | undefined,
        offset: undefined as number | undefined,
      }
      const preview = await new Read().run(commandArgs(context, args))
      let text = preview.data!.messages[0]!.text
      let next = preview.data!.messages[0]!.nextOffset
      while (next !== undefined && requests.length < 10) {
        const result = await new Read().run(commandArgs(context, { ...args, message: 'a1', offset: next }))
        text += result.data!.messages[0]!.text
        next = result.data!.messages[0]!.nextOffset
      }
      const invalid = await new Read().run(commandArgs(context, { ...args, message: 'missing' }))
      assert({
        given: 'a thread preview that cannot fit the final correction',
        should: 'recover all text through the connected API and reject an unrelated message id',
        actual: [
          text,
          requests.length,
          requests.every((request) => request === 'GET /gmail/v1/users/me/threads/ff'),
          invalid.ok,
        ],
        expected: [body, 4, true, false],
      })
    },
  )
})

test('google:email:read returns bodies with precise UTC timestamps', async () => {
  const requests: string[] = []
  await withGmail(
    (url, init) => {
      requests.push(`${init?.method ?? 'GET'} ${url.pathname}?${url.searchParams}`)
      return {
        messages: [
          { id: 'a1', time: '1970-01-01T00:00:00Z', text: 'Earlier message' },
          { id: 'a2', time: '2026-01-05T05:30:42.123-05:00', text: 'Current reply' },
          { id: 'a3', time: undefined, text: 'Undated message' },
        ].map(({ id, time, text }) => ({
          id,
          threadId: 'ff',
          internalDate: time ? String(Instant.from(time).epochMilliseconds) : undefined,
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'Subject', value: 'Atlas kickoff' },
              { name: 'From', value: 'jane@example.com' },
            ],
            body: { data: Buffer.from(text).toString('base64url') },
          },
        })),
      }
    },
    async (context) => {
      const result = await new Read().run(
        commandArgs(context, { thread: 'ff', account: undefined, message: undefined, offset: undefined }),
      )
      assert({
        given: 'Gmail timestamps at epoch zero, with seconds and milliseconds, and absent',
        should: 'return UTC timestamps without dropping precision or inventing a missing date',
        expected: {
          ok: true,
          thread: 'ff',
          subject: 'Atlas kickoff',
          dates: ['1970-01-01T00:00:00.000Z', '2026-01-05T10:30:42.123Z', undefined],
          text: ['Earlier message', 'Current reply', 'Undated message'],
          total: 3,
          omitted: 0,
          truncated: false,
          requests: ['GET /gmail/v1/users/me/threads/ff?format=full'],
        },
        actual: {
          ok: result.ok,
          thread: result.data?.threadId,
          subject: result.data?.subject,
          dates: result.data?.messages.map((row) => row.date),
          text: result.data?.messages.map((row) => row.text),
          total: result.data?.totalMessages,
          omitted: result.data?.omittedMessages,
          truncated: result.data?.truncated,
          requests,
        },
      })
    },
  )
})

test('google:email:read finds the mailbox a thread lives in instead of asking which account', async () => {
  const select = spyOn(prompts, 'select').mockResolvedValue('jane@example.com')
  const asked: string[] = []
  const thread = {
    messages: [
      {
        id: 'b1',
        threadId: 'ff',
        payload: {
          mimeType: 'text/plain',
          headers: [{ name: 'Subject', value: 'Atlas kickoff' }],
          body: { data: Buffer.from('See you Thursday').toString('base64url') },
        },
      },
    ],
  }
  try {
    await withGmail(
      (_url, init) => {
        asked.push(mailboxOf(init))
        // Only one mailbox holds the thread; Gmail answers 404 for a thread a mailbox does not hold
        return mailboxOf(init) === 'jane@example.com' ? thread : new Response('{}', { status: 404 })
      },
      async (context) => {
        await addGmailAccount(context, 'bob@example.com')
        const found = await new Read().run(
          commandArgs(context, { thread: 'ff', account: undefined, message: undefined, offset: undefined }),
        )
        assert({
          given: 'two connected mailboxes, no account named, and a thread only the second one tried holds',
          should: 'read it from that mailbox, say which, and note the one tried first',
          expected: [
            true,
            'jane@example.com',
            'bob@example.com could not open it; used jane@example.com.',
            ['bob@example.com', 'jane@example.com'],
          ],
          actual: [found.ok, found.data?.account, found.data?.accountNote, asked],
        })

        asked.length = 0
        const named = await new Read().run(
          commandArgs(context, { thread: 'ff', account: 'jane', message: undefined, offset: undefined }),
        )
        assert({
          given: 'the account the listing gave for the thread',
          should: 'go straight to that mailbox, with nothing to note',
          expected: [true, ['jane@example.com'], undefined],
          actual: [named.ok, asked, named.data?.accountNote],
        })
      },
    )

    await withGmail(
      () => new Response('{}', { status: 404 }),
      async (context) => {
        await addGmailAccount(context, 'bob@example.com')
        const missing = await new Read().run(
          commandArgs(context, { thread: 'ff', account: undefined, message: undefined, offset: undefined }),
        )
        assert({
          given: 'a thread no connected mailbox holds',
          should: 'fail naming the thread and every mailbox looked in, without opening a picker',
          expected: [true, true, 0],
          actual: [
            missing.failed,
            ['Gmail thread ff', 'jane@example.com', 'bob@example.com'].every((part) => missing.message?.includes(part)),
            select.mock.calls.length,
          ],
        })
      },
    )
  } finally {
    select.mockRestore()
  }
})
