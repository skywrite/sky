import { Buffer } from 'node:buffer'
import { GoogleClient } from '#lib/google/client.ts'
import { GMAIL_SCOPE } from '#lib/google/gmail.ts'
import { saveAccountTokens, saveOAuthClient } from '#lib/google/tokens.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { createVoiceEmailTools, SEARCH_EMAIL } from './emailTools.ts'

const EMAIL = 'jane@example.com'
const SENT_AT = '2026-01-05T10:30:42.123Z'

function message(id: string, labels = ['SENT'], text = 'The Atlas report is attached for review.') {
  return {
    id,
    threadId: 'ff',
    labelIds: labels,
    internalDate: String(Instant.from(SENT_AT).epochMilliseconds),
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'Subject', value: 'Atlas report' },
        { name: 'From', value: `Jane Doe <${EMAIL}>` },
        { name: 'To', value: 'Alex Doe <alex@example.com>' },
      ],
      body: { data: Buffer.from(text).toString('base64url') },
    },
  }
}

async function fixture(respond: (url: URL, init?: RequestInit) => unknown | Promise<unknown>) {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, EMAIL, {
    refreshToken: 'fake-refresh',
    accessToken: 'fake-access',
    scopes: [GMAIL_SCOPE],
  })
  const requests: { url: URL; method: string }[] = []
  const resolutions: { requested?: string; interactive: boolean }[] = []
  const tools = createVoiceEmailTools(
    { secrets },
    {
      resolveClient: async (options) => {
        resolutions.push({ requested: options.requested, interactive: options.interactive })
        return new GoogleClient({
          secrets,
          email: EMAIL,
          client: { clientId: 'fake-client', clientSecret: 'fake-secret' },
          sleep: async () => {},
          fetchFn: (async (input: unknown, init?: RequestInit) => {
            const url = new URL(String(input))
            requests.push({ url, method: init?.method ?? 'GET' })
            const result = await respond(url, init)
            return result instanceof Response ? result : new Response(JSON.stringify(result))
          }) as typeof fetch,
        })
      },
    },
  )
  const run = async (input: Record<string, unknown>, signal?: AbortSignal) =>
    JSON.parse(await tools.get(SEARCH_EMAIL)!.run(input, signal))
  return { run, requests, resolutions }
}

test('voice Gmail search reads matching Sent messages and leaves the mailbox unchanged', async () => {
  const { run, requests, resolutions } = await fixture((url) =>
    url.pathname.endsWith('/messages') ? { messages: [{ id: 'a1', threadId: 'ff' }] } : message('a1'),
  )
  const result = await run({ query: 'in:sent {Atlas "status report"}', account: 'jane', limit: 1 })
  assert({
    given: 'a Gmail search matching one sent message rather than the newest reply in its thread',
    should: 'return its decoded body, actual SENT label, recipients, and millisecond UTC timestamp using only GET',
    actual: {
      ok: result.ok,
      query: requests[0].url.searchParams.get('q'),
      paths: requests.map(({ url }) => url.pathname),
      format: requests[1].url.searchParams.get('format'),
      methods: requests.map(({ method }) => method),
      resolutions,
      evidence: result.messages[0],
    },
    expected: {
      ok: true,
      query: 'in:sent {Atlas "status report"}',
      paths: ['/gmail/v1/users/me/messages', '/gmail/v1/users/me/messages/a1'],
      format: 'full',
      methods: ['GET', 'GET'],
      resolutions: [{ requested: 'jane', interactive: false }],
      evidence: {
        messageId: 'a1',
        threadId: 'ff',
        subject: 'Atlas report',
        from: 'Jane Doe <jane@example.com>',
        to: ['Alex Doe <alex@example.com>'],
        labels: ['SENT'],
        sent: true,
        date: SENT_AT,
        sentAt: SENT_AT,
        text: 'The Atlas report is attached for review.',
        truncated: false,
      },
    },
  })
})

test('voice Gmail search does not turn received replies into sent evidence', async () => {
  const { run } = await fixture((url) =>
    url.pathname.endsWith('/messages')
      ? { messages: [{ id: 'a2', threadId: 'ff' }] }
      : message('a2', ['INBOX', 'UNREAD'], 'Please send the Atlas report.'),
  )
  const result = await run({ query: 'Atlas' })
  assert({
    given: 'a received unread message that mentions the report',
    should: 'preserve its labels and content without claiming a sent timestamp',
    actual: [result.messages[0].sent, result.messages[0].sentAt, result.messages[0].labels, result.messages[0].text],
    expected: [false, undefined, ['INBOX', 'UNREAD'], 'Please send the Atlas report.'],
  })
})

test('voice Gmail search resolves account ambiguity before any network request', async () => {
  const secrets = new TestSecretsProvider()
  await saveOAuthClient(secrets, { clientId: 'fake-client', clientSecret: 'fake-secret' })
  for (const email of ['jane@example.com', 'alex@example.com']) {
    await saveAccountTokens(secrets, email, { refreshToken: 'fake-refresh', scopes: [GMAIL_SCOPE] })
  }
  const tool = createVoiceEmailTools({ secrets }).get(SEARCH_EMAIL)!
  const result = JSON.parse(await tool.run({ query: 'in:sent Atlas' }))
  assert({
    given: 'two authorized accounts and no account choice',
    should: 'return their exact choices without an interactive picker or treating either account as empty',
    actual: [result.ok, result.error.code, result.accounts, result.messages],
    expected: [false, 'account', ['alex@example.com', 'jane@example.com'], undefined],
  })
})

test('voice Gmail search distinguishes empty results, failed reads, and partial evidence', async () => {
  let mode = 'empty'
  const { run } = await fixture((url) => {
    if (url.pathname.endsWith('/messages')) {
      return mode === 'empty' ? {} : { messages: mode === 'partial' ? [{ id: 'a1' }, { id: 'a2' }] : [{ id: 'a2' }] }
    }
    return url.pathname.endsWith('/a1')
      ? message('a1')
      : new Response('{"error":{"message":"Message unavailable"}}', { status: 404 })
  })
  const empty = await run({ query: 'in:sent Atlas' })
  mode = 'failed'
  const failed = await run({ query: 'in:sent Atlas' })
  mode = 'partial'
  const partial = await run({ query: 'in:sent Atlas' })
  assert({
    given: 'an empty search, an unreadable match, and one readable match beside an unreadable one',
    should: 'keep those outcomes distinct and scope every conclusion to the actual search',
    actual: [
      [empty.ok, empty.messages.length, empty.errors.length, empty.partial],
      [failed.ok, failed.messages.length, failed.errors[0].code, failed.partial],
      [partial.ok, partial.messages.length, partial.errors.length, partial.partial],
      [empty, failed, partial].every((result) => result.note.includes('never prove it was not sent')),
    ],
    expected: [[true, 0, 0, false], [false, 0, 'gmail', true], [true, 1, 1, true], true],
  })
})

test('voice Gmail search preserves query pagination and enforces its message limit', async () => {
  const { run, requests, resolutions } = await fixture((url) =>
    url.pathname.endsWith('/messages')
      ? { messages: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }], nextPageToken: 'next-page', resultSizeEstimate: 20 }
      : message(url.pathname.split('/').at(-1)!),
  )
  const invalid = await run({ query: 'Atlas', limit: 6 })
  const result = await run({ query: 'in:sent Atlas', limit: 2, pageToken: 'previous-page' })
  assert({
    given: 'an excessive requested limit and a valid two-message page with more matches',
    should: 'reject excessive requests before account access and expose pagination without reading extra messages',
    actual: [
      invalid.error.code,
      resolutions.length,
      requests[0].url.searchParams.get('maxResults'),
      requests[0].url.searchParams.get('pageToken'),
      requests.length,
      result.messages.map((row: { messageId: string }) => row.messageId),
      result.nextPageToken,
      result.resultSizeEstimate,
      result.omittedMessages,
      result.partial,
    ],
    expected: ['invalid_input', 1, '2', 'previous-page', 3, ['a1', 'a2'], 'next-page', 20, 1, true],
  })
})

test('voice Gmail search caps raw downloads and bounds decoded UTF-8 evidence', async () => {
  let oversized = true
  let cancelled = false
  const { run } = await fixture((url) => {
    if (url.pathname.endsWith('/messages')) return { messages: [{ id: 'a1' }] }
    if (oversized) {
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(600_000))
          },
          cancel() {
            cancelled = true
          },
        }),
      )
    }
    return message('a1', ['SENT'], '🧭'.repeat(5000))
  })
  const large = await run({ query: 'in:sent Atlas' })
  oversized = false
  const bounded = await run({ query: 'in:sent Atlas' })
  assert({
    given: 'an unbounded message stream followed by a long four-byte Unicode body',
    should: 'cancel overlarge downloads and return complete characters with explicit truncation',
    actual: [
      large.ok,
      large.errors[0].code,
      cancelled,
      bounded.messages[0].text,
      bounded.messages[0].truncated,
      bounded.partial,
    ],
    expected: [false, 'too_large', true, '🧭'.repeat(750), true, true],
  })
})

test('voice Gmail search stops a body read when the voice call ends', async () => {
  const controller = new AbortController()
  let started!: () => void
  const reading = new Promise<void>((resolve) => {
    started = resolve
  })
  let cancelled = false
  const { run, requests } = await fixture((url, init) => {
    if (url.pathname.endsWith('/messages')) return { messages: [{ id: 'a1' }, { id: 'a2' }] }
    assert({
      given: 'a voice email read',
      should: 'pass a lifetime signal to the authenticated request',
      actual: !!init?.signal,
      expected: true,
    })
    return new Response(
      new ReadableStream(
        {
          pull() {
            started()
          },
          cancel() {
            cancelled = true
          },
        },
        { highWaterMark: 0 },
      ),
    )
  })
  const resultPromise = run({ query: 'in:sent Atlas' }, controller.signal)
  await reading
  controller.abort(new DOMException('Voice call ended.', 'AbortError'))
  const result = await resultPromise
  assert({
    given: 'a call ending during the first matching body download',
    should: 'cancel its reader and never fetch the second message',
    actual: [result.ok, result.error.code, cancelled, requests.length],
    expected: [false, 'cancelled', true, 2],
  })
})

test('voice Gmail search bounds its serialized result and reports omitted evidence', async () => {
  const { run } = await fixture((url) => {
    if (url.pathname.endsWith('/messages')) return { messages: ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ id })) }
    return message(url.pathname.split('/').at(-1)!, ['SENT'], '\u0000'.repeat(4000))
  })
  const result = await run({ query: 'in:sent Atlas', limit: 5 })
  assert({
    given: 'five message bodies whose control characters expand when serialized to JSON',
    should: 'keep useful evidence within the total byte cap and explicitly count omitted matches',
    actual: [
      result.ok,
      new TextEncoder().encode(JSON.stringify(result)).byteLength <= 32_000,
      result.messages.length > 0,
      result.messages.length + result.omittedMessages,
      result.omittedMessages > 0,
      result.partial,
    ],
    expected: [true, true, true, 5, true, true],
  })
})
