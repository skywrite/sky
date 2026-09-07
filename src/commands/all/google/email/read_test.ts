import { Buffer } from 'node:buffer'
import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { assertAccountAmbiguity, commandArgs, withGmail } from './lib/testGmail.ts'
import Read from './read.ts'

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
      const result = await new Read().run(commandArgs(context, { thread: 'ff', account: undefined }))
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

test('google:email:read fails on ambiguous accounts outside a top-level console', async () => {
  await assertAccountAmbiguity((context) => new Read().run(commandArgs(context, { thread: 'ff', account: undefined })))
})
