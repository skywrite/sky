import { assert, test } from '#test'
import { BeeperClient, BeeperError, beeperInfo } from './client.ts'

type Call = { url: string; method: string; body?: string; auth?: string }

function fetchWith(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      ...(headers.get('authorization') ? { auth: headers.get('authorization')! } : {}),
    }
    calls.push(call)
    return answer(call)
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('beeper client - queries carry the token and repeat array filters; pages parse leniently', async () => {
  const { calls, fetchFn } = fetchWith((call) =>
    call.url.includes('/v1/chats/search')
      ? json({
          items: [
            {
              id: 'c1',
              accountID: 'whatsapp',
              network: 'WhatsApp',
              title: 'Maya Okafor',
              type: 'single',
              participants: { items: [{ id: 'u1', fullName: 'Maya Okafor' }], total: 2 },
              unreadCount: 1,
              extra: 'ignored',
            },
            { id: 'c2', accountID: 'whatsapp', network: 'WhatsApp', title: 'Atlas launch', type: 'broadcast' },
          ],
          hasMore: true,
          oldestCursor: 'o1',
          newestCursor: 'n1',
        })
      : json({ items: [], hasMore: false, oldestCursor: '', newestCursor: '' }),
  )
  const client = new BeeperClient('tok-1', { fetchFn, baseUrl: 'http://127.0.0.1:1' })
  const page = await client.searchChats({ inbox: 'primary', accountIDs: ['a', 'b'], includeMuted: false })
  await client.messages('c1', { cursor: 'n1', direction: 'after' })
  assert({
    given: 'a chat search with two account ids and a message page after a cursor',
    should: 'send both ids, the bearer token, and read the page with an unknown chat type as single',
    actual: [
      calls[0].url,
      calls[0].auth,
      calls[1].url,
      page.items.map((chat) => [chat.id, chat.type, chat.participants?.items[0]?.fullName]),
      [page.hasMore, page.oldestCursor, page.newestCursor],
    ],
    expected: [
      'http://127.0.0.1:1/v1/chats/search?inbox=primary&accountIDs=a&accountIDs=b&includeMuted=false',
      'Bearer tok-1',
      'http://127.0.0.1:1/v1/chats/c1/messages?cursor=n1&direction=after',
      [
        ['c1', 'single', 'Maya Okafor'],
        ['c2', 'single', undefined],
      ],
      [true, 'o1', 'n1'],
    ],
  })
})

test('beeper client - a closed app, a refused token, and a plain failure each read differently', async () => {
  const closed = new BeeperClient('t', {
    baseUrl: 'http://127.0.0.1:1',
    fetchFn: (() => Promise.reject(new TypeError('connect ECONNREFUSED'))) as unknown as typeof fetch,
  })
  const refused = new BeeperClient('t', {
    baseUrl: 'http://127.0.0.1:1',
    fetchFn: (() =>
      Promise.resolve(json({ message: 'Unauthorized: Invalid or missing token' }, 401))) as unknown as typeof fetch,
  })
  const failed = new BeeperClient('t', {
    baseUrl: 'http://127.0.0.1:1',
    fetchFn: (() => Promise.resolve(json({ message: 'Chat not found' }, 404))) as unknown as typeof fetch,
  })
  const odd = new BeeperClient('t', {
    baseUrl: 'http://127.0.0.1:1',
    fetchFn: (() => Promise.resolve(json({ nope: true }))) as unknown as typeof fetch,
  })
  const kinds = await Promise.all(
    [closed, refused, failed, odd].map((client) =>
      client
        .accounts()
        .then(() => 'ok')
        .catch((error: unknown) => (error instanceof BeeperError ? `${error.kind}:${error.status ?? '-'}` : 'other')),
    ),
  )
  assert({
    given: 'four answers from the app',
    should: 'name unavailable, unauthorized, and request failures',
    actual: [kinds, await beeperInfo({ baseUrl: 'http://127.0.0.1:1', fetchFn: closed['options'].fetchFn })],
    expected: [['unavailable:-', 'unauthorized:401', 'request:404', 'request:200'], null],
  })
})

test('beeper client - a draft goes in as JSON and an empty text clears it', async () => {
  const { calls, fetchFn } = fetchWith(() =>
    json({ id: 'c1', accountID: 'a', network: 'Signal', title: 'Jane Doe', type: 'single', draft: { text: 'Hi' } }),
  )
  const client = new BeeperClient('t', { fetchFn, baseUrl: 'http://127.0.0.1:1' })
  const chat = await client.setDraft('c 1', 'Hi')
  await client.setDraft('c 1', '')
  await client.focus({ chatID: 'c 1' })
  assert({
    given: 'two draft writes and a focus',
    should: 'PATCH the escaped chat route with the draft object and POST the focus',
    actual: [calls.map((call) => [call.method, call.url, call.body]), chat.draft?.text],
    expected: [
      [
        ['PATCH', 'http://127.0.0.1:1/v1/chats/c%201', '{"draft":{"text":"Hi"}}'],
        ['PATCH', 'http://127.0.0.1:1/v1/chats/c%201', '{"draft":{"text":""}}'],
        ['POST', 'http://127.0.0.1:1/v1/focus', '{"chatID":"c 1"}'],
      ],
      'Hi',
    ],
  })
})

test('beeper client - nulls read as absent, envelopes without cursors still page, and a bad shape names its field', async () => {
  const { fetchFn } = fetchWith((call) =>
    call.url.includes('/v1/chats/search')
      ? json({
          items: [
            {
              id: 'c1',
              accountID: 'a',
              network: null,
              title: null,
              type: null,
              participants: null,
              draft: { text: null },
              isMuted: null,
            },
          ],
          hasMore: null,
          oldestCursor: null,
          newestCursor: null,
        })
      : call.url.includes('/messages')
        ? json({
            items: [
              {
                id: 'm1',
                chatID: 'c1',
                accountID: 'a',
                senderID: 's',
                timestamp: '2026-03-10T09:12:00.000Z',
                sortKey: '1',
                text: null,
                senderName: null,
                attachments: [{ type: null, fileName: null, transcription: null }],
                mentions: null,
              },
            ],
            hasMore: false,
            oldestCursor: '0',
            newestCursor: '1',
          })
        : json([{ accountID: 'a', bridge: null, user: null, network: null, status: null }]),
  )
  const client = new BeeperClient('t', { fetchFn, baseUrl: 'http://127.0.0.1:1' })
  const [chats, messages, accounts] = await Promise.all([
    client.searchChats(),
    client.messages('c1'),
    client.accounts(),
  ])
  const odd = new BeeperClient('t', {
    baseUrl: 'http://127.0.0.1:1',
    fetchFn: (() => Promise.resolve(json({ items: [{ id: 'c2' }] }))) as unknown as typeof fetch,
  })
  assert({
    given: 'answers where Beeper wrote null for what it has no value for, and one missing a required id',
    should: 'read nulls as absent with the usual defaults, and name the field a required value is missing from',
    actual: [
      [
        chats.items[0].network,
        chats.items[0].title,
        chats.items[0].type,
        chats.items[0].participants,
        chats.items[0].draft,
      ],
      [chats.hasMore, chats.oldestCursor, chats.newestCursor],
      [messages.items[0].text, messages.items[0].senderName, messages.items[0].attachments?.[0].type],
      [accounts[0].bridge, accounts[0].user, accounts[0].network],
      await odd.searchChats().catch((error: unknown) => (error instanceof BeeperError ? error.message : 'other')),
    ],
    expected: [
      ['', '', 'single', undefined, { text: '' }],
      [false, undefined, undefined],
      [undefined, undefined, 'unknown'],
      [undefined, undefined, undefined],
      'Beeper answered in a shape Sky does not understand (items.0.accountID: Invalid input: expected string, received undefined).',
    ],
  })
})
