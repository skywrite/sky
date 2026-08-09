import { Buffer } from 'node:buffer'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { GoogleClient } from './client.ts'
import {
  GMAIL_SCOPE,
  getAttachment,
  getThread,
  hasGmailScope,
  listThreads,
  modifyThread,
  resolveLabelId,
  threadIdFromDecimal,
  threadIdToDecimal,
} from './gmail.ts'
import { saveAccountTokens } from './tokens.ts'

type RecordedCall = { url: string; init?: RequestInit }

async function clientWith(responses: unknown[], calls: RecordedCall[]): Promise<GoogleClient> {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(responses[Math.min(calls.length, responses.length) - 1]), { status: 200 })
  }) as typeof fetch
  return new GoogleClient({
    secrets,
    email: 'jane@example.com',
    client: { clientId: 'id', clientSecret: 'sec' },
    fetchFn,
    sleep: async () => {},
  })
}

function b64url(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64url')
}

test('threadId renderings', () => {
  assert({
    given: 'the same 64-bit thread id in API hex and X-GM-THRID decimal',
    should: 'convert between the two renderings losslessly',
    expected: ['255', 'ff', '18c2f3a4b5d6e7f8'],
    actual: [
      threadIdToDecimal('ff'),
      threadIdFromDecimal('255'),
      threadIdFromDecimal(threadIdToDecimal('18c2f3a4b5d6e7f8')),
    ],
  })
})

test('listThreads', async () => {
  const calls: RecordedCall[] = []
  const client = await clientWith(
    [
      { threads: [{ id: 't1', snippet: 's1' }, { id: 't2' }], nextPageToken: 'p2' },
      { threads: [{ id: 't3' }, { id: 't4' }] },
    ],
    calls,
  )

  const threads = await listThreads(client, { q: 'label:sky-follow', labelIds: ['Label_7'], limit: 3 })

  const first = new URL(calls[0].url)
  assert({
    given: 'a query, a label id, and a limit',
    should: 'pass them through and size the first page to the limit',
    expected: ['/gmail/v1/users/me/threads', 'label:sky-follow', ['Label_7'], '3', null],
    actual: [
      first.pathname,
      first.searchParams.get('q'),
      first.searchParams.getAll('labelIds'),
      first.searchParams.get('maxResults'),
      first.searchParams.get('pageToken'),
    ],
  })

  assert({
    given: 'a nextPageToken and more matches than the limit',
    should: 'follow the token, then cut the concatenated refs at the limit',
    expected: [2, 'p2', ['t1', 't2', 't3']],
    actual: [calls.length, new URL(calls[1].url).searchParams.get('pageToken'), threads.map((t) => t.id)],
  })
})

test('getThread', async () => {
  const calls: RecordedCall[] = []
  const client = await clientWith(
    [
      {
        messages: [
          {
            id: 'm1',
            threadId: 't1',
            labelIds: ['INBOX', 'Label_7'],
            internalDate: String(Date.UTC(2026, 0, 5, 10, 30)),
            payload: {
              mimeType: 'multipart/alternative',
              headers: [
                { name: 'Subject', value: '=?UTF-8?Q?Caf=C3=A9_plan?=' },
                { name: 'From', value: '"Doe, Jane" <jane@example.com>' },
                { name: 'To', value: 'sam@example.com, "Roe, Sam" <sam.roe@example.com>' },
                { name: 'Message-ID', value: '<msg-1@example.com>' },
              ],
              parts: [
                { mimeType: 'text/plain', body: { data: b64url('Hello Café ✓') } },
                { mimeType: 'text/html', body: { data: b64url('<p>Hello Café ✓</p>') } },
              ],
            },
          },
          {
            id: 'm2',
            threadId: 't1',
            internalDate: String(Date.UTC(2026, 0, 6, 9, 0)),
            payload: {
              mimeType: 'multipart/mixed',
              headers: [
                {
                  name: 'Subject',
                  value: '=?utf-8?B?' + Buffer.from('Re: Café plan', 'utf-8').toString('base64') + '?=',
                },
                { name: 'From', value: 'sam@example.com' },
                { name: 'In-Reply-To', value: '<msg-1@example.com>' },
              ],
              parts: [
                { mimeType: 'text/plain', body: { data: b64url('Attached.') } },
                {
                  mimeType: 'application/pdf',
                  filename: 'atlas-report.pdf',
                  body: { attachmentId: 'att1', size: 12345 },
                },
                {
                  mimeType: 'image/png',
                  filename: 'image001.png',
                  headers: [{ name: 'Content-Disposition', value: 'inline; filename="image001.png"' }],
                  body: { attachmentId: 'att2', size: 500 },
                },
              ],
            },
          },
          { snippet: 'ghost without id' },
        ],
      },
    ],
    calls,
  )

  const messages = await getThread(client, 't1', { format: 'full' })

  const first = new URL(calls[0].url)
  assert({
    given: 'a thread id and the full format',
    should: 'fetch the thread with format passed through and skip malformed messages',
    expected: ['/gmail/v1/users/me/threads/t1', 'full', 2],
    actual: [first.pathname, first.searchParams.get('format'), messages.length],
  })

  assert({
    given: 'encoded-word headers, a quoted display name with a comma, and alternative bodies',
    should: 'decode Q-words, keep the comma inside one recipient, and decode both bodies',
    expected: {
      subject: 'Café plan',
      from: { name: 'Doe, Jane', address: 'jane@example.com' },
      to: [{ address: 'sam@example.com' }, { name: 'Roe, Sam', address: 'sam.roe@example.com' }],
      date: '2026-01-05T10:30:00.000Z',
      messageId: '<msg-1@example.com>',
      bodyText: 'Hello Café ✓',
      bodyHtml: '<p>Hello Café ✓</p>',
      labelIds: ['INBOX', 'Label_7'],
    },
    actual: {
      subject: messages[0].subject,
      from: messages[0].from,
      to: messages[0].to,
      date: messages[0].date?.toISOString(),
      messageId: messages[0].messageId,
      bodyText: messages[0].bodyText,
      bodyHtml: messages[0].bodyHtml,
      labelIds: messages[0].labelIds,
    },
  })

  assert({
    given: 'a B-encoded subject, a real attachment, and an inline signature image',
    should: 'decode the subject, keep the attachment, and drop the signature image',
    expected: {
      subject: 'Re: Café plan',
      inReplyTo: '<msg-1@example.com>',
      attachments: [
        { filename: 'atlas-report.pdf', contentType: 'application/pdf', size: 12345, attachmentId: 'att1' },
      ],
    },
    actual: {
      subject: messages[1].subject,
      inReplyTo: messages[1].inReplyTo,
      attachments: messages[1].attachments,
    },
  })
})

test('resolveLabelId', async () => {
  const labelsPage = {
    labels: [
      { id: 'INBOX', name: 'INBOX', type: 'system' },
      { id: 'Label_7', name: 'Sky/Follow', type: 'user' },
    ],
  }
  const calls: RecordedCall[] = []
  const client = await clientWith([labelsPage, labelsPage, labelsPage], calls)

  assert({
    given: 'a label list with a user label',
    should: 'resolve exact and case-insensitive names, and miss unknown ones',
    expected: ['Label_7', 'Label_7', undefined],
    actual: [
      await resolveLabelId(client, 'Sky/Follow'),
      await resolveLabelId(client, 'sky/follow'),
      await resolveLabelId(client, 'Nope'),
    ],
  })
})

test('modifyThread', async () => {
  const calls: RecordedCall[] = []
  const client = await clientWith([{}], calls)

  await modifyThread(client, 't1', { removeLabelIds: ['INBOX', 'Label_7'] })

  assert({
    given: 'a label removal',
    should: 'POST to the thread modify endpoint with both id lists always present',
    expected: [
      '/gmail/v1/users/me/threads/t1/modify',
      'POST',
      { addLabelIds: [], removeLabelIds: ['INBOX', 'Label_7'] },
    ],
    actual: [new URL(calls[0].url).pathname, calls[0].init?.method, JSON.parse(String(calls[0].init?.body))],
  })
})

test('getAttachment', async () => {
  const calls: RecordedCall[] = []
  const client = await clientWith([{ data: Buffer.from([0xfb, 0xff, 0xfe]).toString('base64url') }], calls)

  const bytes = await getAttachment(client, 'm2', 'att1')

  assert({
    given: 'URL-safe base64 attachment data',
    should: 'fetch the attachment endpoint and decode the raw bytes',
    expected: ['/gmail/v1/users/me/messages/m2/attachments/att1', [0xfb, 0xff, 0xfe]],
    actual: [new URL(calls[0].url).pathname, Array.from(bytes)],
  })
})

test('hasGmailScope', () => {
  assert({
    given: 'tokens granted before and after the Gmail scope was added',
    should: 'detect only the grant that includes it',
    expected: [false, true],
    actual: [
      hasGmailScope({ refreshToken: 'rt', scopes: ['https://www.googleapis.com/auth/drive'] }),
      hasGmailScope({ refreshToken: 'rt', scopes: [GMAIL_SCOPE] }),
    ],
  })
})
