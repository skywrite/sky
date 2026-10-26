import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import {
  NotionClient,
  notionId,
  openNotion,
  pageOf,
  searchOf,
  selfOf,
  tableOf,
  targetOf,
  teamspacesOf,
} from './client.ts'
import { NOTION_NOT_CONNECTED, NOTION_SIGNED_OUT, NOTION_UNREACHABLE, NotionError } from './errors.ts'
import { NOTION_MCP_URL, type NotionGrant } from './oauth.ts'
import { loadNotionGrant, NOTION_GRANT_ENTRY, NOTION_SECRETS_CATEGORY } from './secrets.ts'

const TOKEN_URL = 'https://mcp.example.com/token'

type Sent = {
  id?: number
  method: string
  auth: string
  session: string | null
  version: string | null
  params: unknown
}

type Answer = Response | ((sent: Sent) => Response)

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const reply = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result })

const toolText = (text: string, isError = false) => ({ content: [{ type: 'text', text }], isError })

/**
 * Notion's MCP server, scripted: initialize opens session s-1, the
 * notification is accepted, and each tools/call takes the next answer.
 */
function mcpFake(calls: Answer[], renewal?: Response) {
  const sent: Sent[] = []
  const renewals: string[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === TOKEN_URL) {
      renewals.push(typeof init?.body === 'string' ? init.body : '')
      return renewal ?? json({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 })
    }
    if (url !== NOTION_MCP_URL) return json({}, 404)
    const headers = new Headers(init?.headers)
    const message = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: unknown }
    const call: Sent = {
      ...(message.id !== undefined ? { id: message.id } : {}),
      method: message.method,
      auth: headers.get('authorization') ?? '',
      session: headers.get('mcp-session-id'),
      version: headers.get('mcp-protocol-version'),
      params: message.params,
    }
    sent.push(call)
    if (message.method === 'initialize')
      return json(reply(message.id, { protocolVersion: '2025-06-18', capabilities: {} }), 200, {
        'Mcp-Session-Id': 's-1',
      })
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const next = calls.shift()
    if (!next) return json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unscripted' } })
    const response = typeof next === 'function' ? next(call) : next
    // A scripted body with id 0 stands for "whatever id this call carried".
    if (response.headers.get('content-type')?.includes('application/json') && response.status === 200) {
      const body = (await response.json()) as { id?: unknown }
      return json({ ...body, id: body.id === 0 ? message.id : body.id })
    }
    return response
  }) as unknown as typeof fetch
  return { sent, renewals, fetchFn }
}

const grant = (changes: Partial<NotionGrant> = {}): NotionGrant => ({
  accessToken: 'at-old',
  refreshToken: 'rt-old',
  clientId: 'sky-client',
  tokenEndpoint: TOKEN_URL,
  workspace: 'Atlas',
  ...changes,
})

const keychain = (stored: NotionGrant | null = grant()) =>
  new TestSecretsProvider(
    stored ? { [`${NOTION_SECRETS_CATEGORY}/${NOTION_GRANT_ENTRY}`]: createSecret(JSON.stringify(stored)) } : {},
  )

test('notion client - a first call opens a session, then carries its id and version with the bearer token', async () => {
  const answer = JSON.stringify({
    results: [{ id: 'p-1', title: 'Atlas launch plan', url: 'https://app.notion.com/p/p1?pvs=204', type: 'page' }],
  })
  const { sent, fetchFn } = mcpFake([json(reply(0, toolText(answer)))])
  const client = new NotionClient(grant(), keychain(), { fetchFn })
  const found = await client.search('launch')
  assert({
    given: 'a search on a fresh client',
    should: 'initialize without session headers, announce it, then call notion-search inside the session',
    actual: {
      found,
      methods: sent.map((call) => call.method),
      first: [sent[0]!.session, sent[0]!.version, sent[0]!.auth],
      call: [sent[2]!.session, sent[2]!.version, sent[2]!.params],
    },
    expected: {
      found: { matches: [{ title: 'Atlas launch plan', type: 'page', url: 'https://app.notion.com/p/p1', id: 'p-1' }] },
      methods: ['initialize', 'notifications/initialized', 'tools/call'],
      first: [null, null, 'Bearer at-old'],
      call: ['s-1', '2025-06-18', { name: 'notion-search', arguments: { query: 'launch' } }],
    },
  })
})

test('notion client - an event-stream answer is read past Notion’s progress notes', async () => {
  const stream = (sent: Sent) => {
    const body = [
      'event: message',
      `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}`,
      '',
      'event: message',
      `data: ${JSON.stringify(reply(sent.id, toolText('# Atlas launch plan\n\nShip in March.')))}`,
      '',
      '',
    ].join('\n')
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const { fetchFn } = mcpFake([stream])
  const page = await new NotionClient(grant(), keychain(), { fetchFn }).fetch('https://www.notion.so/abc')
  assert({
    given: 'a stream carrying a progress note and then the reply with this call’s id',
    should: 'return the reply’s text',
    actual: page,
    expected: { text: '# Atlas launch plan\n\nShip in March.' },
  })
})

test('notion client - a tool’s own failure, and an unreachable Notion, read as plain words', async () => {
  const failing = mcpFake([json(reply(0, toolText('object_not_found: no page with that id', true)))])
  const tool = await new NotionClient(grant(), keychain(), { fetchFn: failing.fetchFn })
    .fetch('nope')
    .catch((error: unknown) => error)
  const offline = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
  const network = await new NotionClient(grant(), keychain(), { fetchFn: offline })
    .search('x')
    .catch((error: unknown) => error)
  assert({
    given: 'a tool answering isError, then a network that fails',
    should: 'throw Notion’s own words for the first and the unreachable sentence for the second',
    actual: [
      tool instanceof NotionError ? [tool.kind, tool.message] : String(tool),
      network instanceof NotionError ? [network.kind, network.message] : String(network),
    ],
    expected: [
      ['tool', 'object_not_found: no page with that id'],
      ['unavailable', NOTION_UNREACHABLE],
    ],
  })
})

test('notion client - a refused token is renewed once, the call is sent again, and the keychain keeps the new grant', async () => {
  const secrets = keychain()
  const { sent, renewals, fetchFn } = mcpFake([
    new Response(null, { status: 401 }),
    json(reply(0, toolText('found it'))),
  ])
  const found = await new NotionClient(grant(), secrets, { fetchFn }).search('atlas')
  const stored = await loadNotionGrant(secrets)
  assert({
    given: 'a call answered 401 with the old token',
    should: 'renew with the refresh token, succeed with the new token, and store the new pair with the names kept',
    actual: {
      found,
      renewals: renewals.map((body) => new URLSearchParams(body).get('refresh_token')),
      tokens: sent.filter((call) => call.method === 'tools/call').map((call) => call.auth),
      stored: [stored?.accessToken, stored?.refreshToken, stored?.workspace],
    },
    expected: {
      found: { text: 'found it' },
      renewals: ['rt-old'],
      tokens: ['Bearer at-old', 'Bearer at-new'],
      stored: ['at-new', 'rt-new', 'Atlas'],
    },
  })
})

test('notion client - a renewal Notion refuses, or a disconnect meanwhile, ends as signed out', async () => {
  const refusedFake = mcpFake(
    [new Response(null, { status: 401 })],
    json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400),
  )
  const refused = await new NotionClient(grant(), keychain(), { fetchFn: refusedFake.fetchFn })
    .search('x')
    .catch((error: unknown) => error)
  const goneFake = mcpFake([new Response(null, { status: 401 })])
  const gone = await new NotionClient(grant(), keychain(null), { fetchFn: goneFake.fetchFn })
    .search('x')
    .catch((error: unknown) => error)
  assert({
    given: 'a refused refresh token, then a grant removed from the keychain while the call ran',
    should: 'ask to connect again, and never renew a grant the person disconnected',
    actual: [
      refused instanceof NotionError ? [refused.kind, refused.message] : String(refused),
      gone instanceof NotionError ? [gone.kind, gone.message] : String(gone),
      goneFake.renewals.length,
    ],
    expected: [['unauthorized', NOTION_SIGNED_OUT], ['unauthorized', NOTION_NOT_CONNECTED], 0],
  })
})

test('notion client - a session Notion forgot is opened again for one more try', async () => {
  const { sent, fetchFn } = mcpFake([new Response(null, { status: 404 }), json(reply(0, toolText('second time')))])
  const found = await new NotionClient(grant(), keychain(), { fetchFn }).search('atlas')
  assert({
    given: 'a call answered 404 inside a session',
    should: 'initialize again and repeat the call',
    actual: [found, sent.map((call) => call.method)],
    expected: [
      { text: 'second time' },
      [
        'initialize',
        'notifications/initialized',
        'tools/call',
        'initialize',
        'notifications/initialized',
        'tools/call',
      ],
    ],
  })
})

test('notion client - an expired grant is renewed before the first call, and no grant means no client', async () => {
  const { sent, renewals, fetchFn } = mcpFake([json(reply(0, toolText('fresh')))])
  const stale = grant({ expiresAt: '2020-01-01T00:00:00Z' })
  const found = await new NotionClient(stale, keychain(stale), { fetchFn }).search('atlas')
  assert({
    given: 'a grant past its expiry, then a keychain with none',
    should: 'renew first and call with the new token; open nothing without a grant',
    actual: [found, renewals.length, sent[0]!.auth, await openNotion(keychain(null))],
    expected: [{ text: 'fresh' }, 1, 'Bearer at-new', null],
  })
})

test('notion self - reads the workspace and the person out of notion-get-self’s JSON', () => {
  assert({
    given: 'get-self answers, a person with an email and an unreadable one',
    should: 'keep the names it finds and nothing else',
    actual: [
      selfOf(
        JSON.stringify({
          workspace: { id: 'w1', name: 'Atlas' },
          user: { type: 'person', id: 'u1', name: 'Jane Doe', email: 'jane@example.com' },
        }),
      ),
      selfOf('not json'),
    ],
    expected: [{ workspace: 'Atlas', user: 'Jane Doe', email: 'jane@example.com' }, {}],
  })
})

test('notion answers - a search reads into matches and a fetch into the page’s own text, else they pass as they came', () => {
  const search = JSON.stringify({
    results: [
      {
        id: 'p-1',
        title: 'Atlas launch plan',
        url: 'https://app.notion.com/p/p1?pvs=204',
        type: 'page',
        highlight: 'Atlas **launch** plan',
        timestamp: '2026-03-25T18:38:00.000Z',
        path: 'Product',
      },
      { id: 'p-2', url: 'https://app.notion.com/p/p2', type: 'page' },
    ],
  })
  const fetched = JSON.stringify({
    metadata: { type: 'page' },
    title: 'Atlas launch plan',
    url: 'https://app.notion.com/p/p1?pvs=204',
    text: '<page url="https://app.notion.com/p/p1">\n<content>\nShip in "March".\n</content>\n</page>',
    path: 'Product',
    page_last_edited_at: '2026-03-25T18:38:01.090Z',
  })
  assert({
    given: 'answers shaped like Notion’s, a result without a title, and answers that are not JSON',
    should: 'keep titled matches with clean links, unwrap the page text, and hand the others on unchanged',
    actual: [searchOf(search), pageOf(fetched), searchOf('plain words'), pageOf('{"no":"text"}')],
    expected: [
      {
        matches: [
          {
            title: 'Atlas launch plan',
            type: 'page',
            url: 'https://app.notion.com/p/p1',
            id: 'p-1',
            path: 'Product',
            edited: '2026-03-25T18:38:00.000Z',
            highlight: 'Atlas **launch** plan',
          },
        ],
      },
      {
        text: '<page url="https://app.notion.com/p/p1">\n<content>\nShip in "March".\n</content>\n</page>',
        title: 'Atlas launch plan',
        url: 'https://app.notion.com/p/p1',
        path: 'Product',
        edited: '2026-03-25T18:38:01.090Z',
      },
      { text: 'plain words' },
      { text: '{"no":"text"}' },
    ],
  })
})

/** A table's markup as Notion writes it: a data source tag, and the JSON state naming the title column. */
const tableMarkup = (id: string, title = 'Name') =>
  `<data-source url="{{collection://${id}}}">\n<data-source-state>\n` +
  `${JSON.stringify({ schema: { [title]: { name: title, type: 'title' }, Due: { name: 'Due', type: 'date' } } })}\n` +
  '</data-source-state>\n</data-source>'

test('notion client - new pages go private in draft mode, or under the parent named, and come back as links', async () => {
  const answer = (id: string) =>
    json(reply(0, toolText(JSON.stringify({ pages: [{ id, url: `https://app.notion.com/p/${id}?pvs=204` }] }))))
  const { sent, fetchFn } = mcpFake([answer('a1'), answer('b2'), answer('c3'), answer('d4')])
  const client = new NotionClient(grant(), keychain(), { fetchFn })
  const made = [
    await client.createPages([{ properties: { title: 'Atlas launch plan' }, content: '## Goals', icon: '🚀' }]),
    await client.createPages([{ properties: { title: 'Kickoff notes' } }], { page: 'p1' }),
    await client.createPages([{ properties: { Name: 'Draft the brief', Points: 3 } }], { dataSource: 'ds-1' }),
    await client.createPages([{ properties: { title: 'Hiring plan' } }], { teamspace: 't-1' }),
  ]
  const calls = sent.filter((call) => call.method === 'tools/call').map((call) => call.params)
  assert({
    given: 'a page with no parent, then one under a page, a row in a table and one at a teamspace’s top',
    should: 'ask for a private draft first, name each parent in Notion’s own shape, and hand back clean links',
    actual: { made, calls },
    expected: {
      made: [
        [{ url: 'https://app.notion.com/p/a1' }],
        [{ url: 'https://app.notion.com/p/b2' }],
        [{ url: 'https://app.notion.com/p/c3' }],
        [{ url: 'https://app.notion.com/p/d4' }],
      ],
      calls: [
        {
          name: 'notion-create-pages',
          arguments: {
            pages: [{ properties: { title: 'Atlas launch plan' }, content: '## Goals', icon: '🚀' }],
            creation_mode: 'draft',
          },
        },
        {
          name: 'notion-create-pages',
          arguments: {
            pages: [{ properties: { title: 'Kickoff notes' } }],
            parent: { type: 'page_id', page_id: 'p1' },
          },
        },
        {
          name: 'notion-create-pages',
          arguments: {
            pages: [{ properties: { Name: 'Draft the brief', Points: 3 } }],
            parent: { type: 'data_source_id', data_source_id: 'ds-1' },
          },
        },
        {
          name: 'notion-create-pages',
          arguments: { pages: [{ properties: { title: 'Hiring plan' } }], parent: { teamspace_id: 't-1' } },
        },
      ],
    },
  })
})

test('notion client - a new table is made from its CREATE TABLE statement and says where its rows go', async () => {
  const markup = `Created database: <database url="{{https://app.notion.com/p/db1}}" inline="false">\n${tableMarkup('ds-1')}\n</database>`
  const { sent, fetchFn } = mcpFake([
    json(reply(0, toolText(JSON.stringify({ result: markup })))),
    json(reply(0, toolText(JSON.stringify({ result: 'Created database: no tags' })))),
  ])
  const client = new NotionClient(grant(), keychain(), { fetchFn })
  const onPage = await client.createTable('Atlas tasks', 'CREATE TABLE ("Name" TITLE)', 'p1')
  const privately = await client.createTable('Q3 metrics', 'CREATE TABLE ("Metric" TITLE)')
  const calls = sent.filter((call) => call.method === 'tools/call').map((call) => call.params)
  assert({
    given: 'a table on a page, then a private one whose answer names nothing',
    should: 'send the parent only when there is one, and read the link, data source and title column it can find',
    actual: { onPage, privately, calls },
    expected: {
      onPage: { url: 'https://app.notion.com/p/db1', dataSource: { id: 'ds-1', titleColumn: 'Name' } },
      privately: {},
      calls: [
        {
          name: 'notion-create-database',
          arguments: {
            parent: { type: 'page_id', page_id: 'p1' },
            title: 'Atlas tasks',
            schema: 'CREATE TABLE ("Name" TITLE)',
          },
        },
        { name: 'notion-create-database', arguments: { title: 'Q3 metrics', schema: 'CREATE TABLE ("Metric" TITLE)' } },
      ],
    },
  })
})

test('notion client - a tool’s JSON error reads as Notion’s own message', async () => {
  const error = JSON.stringify({
    name: 'APIResponseError',
    code: 'validation_error',
    status: 400,
    message: 'Can’t edit block that is archived.',
  })
  const { fetchFn } = mcpFake([json(reply(0, toolText(error, true)))])
  const refused = await new NotionClient(grant(), keychain(), { fetchFn })
    .createPages([{ properties: { title: 'Atlas' } }], { page: 'p1' })
    .catch((caught: unknown) => caught)
  assert({
    given: 'a create that Notion refuses with a JSON error',
    should: 'throw the message inside it, not the JSON',
    actual: refused instanceof NotionError ? [refused.kind, refused.message] : String(refused),
    expected: ['tool', 'Can’t edit block that is archived.'],
  })
})

test('notion answers - a fetch says whether a link is a page or a table, and a teamspace list reads the person’s own first', () => {
  const page = JSON.stringify({
    metadata: { type: 'page' },
    title: 'Atlas',
    url: 'https://app.notion.com/p/0123456789abcdef0123456789abcdef?pvs=204',
    text: '<page>…</page>',
  })
  const table = (type: string, text: string) => JSON.stringify({ metadata: { type }, title: 'Atlas tasks', text })
  const teams = JSON.stringify({
    joinedTeams: [{ id: 't-1', name: 'Engineering', in_trash: false }],
    otherTeams: [
      { id: 't-2', name: 'Design', in_trash: false },
      { id: 't-3', name: 'Old', in_trash: true },
    ],
    hasMore: false,
  })
  assert({
    given: 'a page, a database with two sources, a data source, a view, and a teamspace list',
    should: 'name the page’s id, each source with its title column, nothing for the view, and live teamspaces',
    actual: [
      targetOf(page, 'x'),
      targetOf(table('database', `${tableMarkup('ds-1')}\n${tableMarkup('ds-2', 'Task')}`), 'x'),
      targetOf(table('data_source', tableMarkup('ds-3')), 'x'),
      targetOf(JSON.stringify({ metadata: { type: 'view' }, title: 'Board' }), 'x'),
      targetOf('not json', 'x'),
      teamspacesOf(teams),
    ],
    expected: [
      { kind: 'page', id: '0123456789abcdef0123456789abcdef', title: 'Atlas' },
      {
        kind: 'table',
        dataSources: [
          { id: 'ds-1', titleColumn: 'Name' },
          { id: 'ds-2', titleColumn: 'Task' },
        ],
        title: 'Atlas tasks',
      },
      { kind: 'table', dataSources: [{ id: 'ds-3', titleColumn: 'Name' }], title: 'Atlas tasks' },
      { kind: 'other', title: 'Board' },
      { kind: 'other' },
      [
        { id: 't-1', name: 'Engineering', joined: true },
        { id: 't-2', name: 'Design', joined: false },
      ],
    ],
  })
})

test('notion ids - the id comes out of a link past its title words, with or without dashes', () => {
  assert({
    given: 'a link with a title slug ending in hex letters, a dashed id, a link with a peek, and plain words',
    should: 'give the page’s own 32-character id, and nothing for the words',
    actual: [
      notionId('https://www.notion.so/atlas/Cafe-face-0123456789abcdef0123456789abcdef'),
      notionId('01234567-89AB-cdef-0123-456789abcdef'),
      notionId('https://app.notion.com/p/0123456789abcdef0123456789abcdef?p=fedcba9876543210fedcba9876543210'),
      notionId('Engineering'),
    ],
    expected: [
      '0123456789abcdef0123456789abcdef',
      '0123456789abcdef0123456789abcdef',
      '0123456789abcdef0123456789abcdef',
      undefined,
    ],
  })
})

test('notion answers - a table answer that is not JSON is read as markup', () => {
  const markup = `<database url="https://app.notion.com/p/db1">\n${tableMarkup('ds-1')}\n</database>`
  assert({
    given: 'create-database markup without the JSON wrapper or the braces',
    should: 'still find the link and the data source',
    actual: tableOf(markup),
    expected: { url: 'https://app.notion.com/p/db1', dataSource: { id: 'ds-1', titleColumn: 'Name' } },
  })
})
