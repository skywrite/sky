import { assert, test } from '#test'
import { fetchDmMembership, resolveHandleNames, resolveUsergroupNames, resolveUserNames } from './resolveNames.ts'

test('fetchDmMembership: harvests member ids and the self id from the boot payload', async () => {
  const membership = await fetchDmMembership('https://atlas.slack.com', async (_url, method) => {
    assert({
      given: 'the membership fetch',
      should: 'call client.userBoot',
      actual: method,
      expected: 'client.userBoot',
    })
    return {
      ok: true,
      self: { id: 'U0SELF00001' },
      channels: [
        { id: 'C0GROUPLIVE', members: ['U0SELF00001', 'U0ALICE0001'] },
        { id: 'C0NOMEMBERS' },
        { id: 42, members: ['U0IGNORED01'] },
      ],
      ims: [{ id: 'D0123ABCDEF', members: ['U0SELF00001', 'U0DANA00001'] }],
      mpims: 'not-an-array',
    }
  })
  assert({
    given: 'a boot payload with channels and ims sections',
    should: 'map member ids by conversation id and surface the self id',
    actual: {
      selfId: membership.selfId,
      live: membership.membersByChannel.get('C0GROUPLIVE'),
      im: membership.membersByChannel.get('D0123ABCDEF'),
      empty: membership.membersByChannel.has('C0NOMEMBERS'),
    },
    expected: {
      selfId: 'U0SELF00001',
      live: ['U0SELF00001', 'U0ALICE0001'],
      im: ['U0SELF00001', 'U0DANA00001'],
      empty: false,
    },
  })
  assert({
    given: 'a blocked boot endpoint',
    should: 'degrade to an empty membership',
    actual: (await fetchDmMembership('https://atlas.slack.com', async () => undefined)).membersByChannel.size,
    expected: 0,
  })
})

const groupsPayload = {
  ok: true as const,
  usergroups: [
    { id: 'S0123TEAMAB', handle: 'atlas-core', name: 'Atlas Core Team' },
    { id: 'S0456TEAMCD', name: 'Atlas Ops Team' },
    { id: 'S0789OTHERX', handle: 'atlas-other', name: 'Atlas Other' },
  ],
}

test('resolveUserNames: one bulk edge call covers every id on Grid', async () => {
  const apiCalls: string[] = []
  let edgeArgs: unknown[] | undefined
  const names = await resolveUserNames(
    ['U0123ABCDEF', 'U0456GHIJKL', 'U0999MISSED'],
    'https://atlas.slack.com',
    async (_url, method) => {
      apiCalls.push(method)
      return method === 'auth.test' ? { ok: true, enterprise_id: 'E0123ENTABC' } : undefined
    },
    async (...args) => {
      edgeArgs = args
      return {
        ok: true,
        results: [
          { id: 'U0123ABCDEF', real_name: 'Jane Smith', name: 'jsmith' },
          { id: 'U0456GHIJKL', profile: { display_name: 'Mike' }, name: 'mdoe' },
          { id: 'U0999MISSED', deleted: true, name: 'ghost' },
        ],
      }
    },
  )
  assert({
    given: 'three ids on an Enterprise Grid workspace',
    should: 'send them all to the edge cache in one call',
    actual: { apiCalls, edgeArgs },
    expected: {
      apiCalls: ['auth.test'],
      edgeArgs: [
        'https://atlas.slack.com',
        'E0123ENTABC',
        'users/info',
        { ids: ['U0123ABCDEF', 'U0456GHIJKL', 'U0999MISSED'] },
      ],
    },
  })
  assert({
    given: 'edge results with varying name fields',
    should: 'prefer real_name, then display_name, then the handle',
    actual: [...names.entries()].sort(),
    expected: [
      ['U0123ABCDEF', 'Jane Smith'],
      ['U0456GHIJKL', 'Mike'],
      ['U0999MISSED', 'ghost'],
    ],
  })
})

test('resolveHandleNames: Grid path searches each handle once, exact matches only', async () => {
  const searched: Array<Record<string, unknown>> = []
  const names = await resolveHandleNames(
    ['alice', 'ghost-handle'],
    'https://atlas.slack.com',
    async () => ({ ok: true, enterprise_id: 'E0123ENTABC' }),
    async (_url, _scope, path, payload) => {
      searched.push({ path, payload })
      const query = (payload as { query: string }).query
      if (query === 'alice') {
        // fuzzy search returns near-misses too — only the exact name counts
        return {
          ok: true,
          results: [
            { id: 'U2', name: 'alice.b', real_name: 'Alice Brown' },
            { id: 'U1', name: 'Alice', real_name: 'Alice Doe' },
          ],
        }
      }
      return { ok: true, results: [{ id: 'U9', name: 'ghost', real_name: 'Someone Else' }] }
    },
  )
  assert({
    given: 'two handles on an Enterprise Grid workspace',
    should: 'run one people-search per handle',
    actual: searched,
    expected: [
      { path: 'users/search', payload: { query: 'alice', count: 5, fuzz: 1 } },
      { path: 'users/search', payload: { query: 'ghost-handle', count: 5, fuzz: 1 } },
    ],
  })
  assert({
    given: 'fuzzy results with one exact name match and one with none',
    should: 'map only the exact match, case-insensitively',
    actual: [...names.entries()],
    expected: [['alice', 'Alice Doe']],
  })
})

test('resolveHandleNames: non-Grid path sweeps users.list pages', async () => {
  const pages: Array<Record<string, unknown> | undefined> = [
    { ok: true }, // auth.test — no enterprise_id, so the sweep runs
    {
      ok: true,
      members: [
        { id: 'U1', name: 'alice', real_name: 'Alice Doe' },
        { id: 'U2', name: 'unrelated', real_name: 'Someone Else' },
      ],
      response_metadata: { next_cursor: 'page2' },
    },
    {
      ok: true,
      members: [{ id: 'U3', name: 'bob.smith', profile: { display_name: 'Bob' } }],
      response_metadata: { next_cursor: 'page3' },
    },
    { ok: true, members: [{ id: 'U4', name: 'never-reached' }] },
  ]
  const asked: Array<Record<string, unknown>> = []
  const names = await resolveHandleNames(
    ['alice', 'bob.smith', 'ghost-handle'],
    'https://atlas.slack.com',
    async (_url, method, params) => {
      asked.push({ method, params })
      return pages[asked.length - 1]
    },
  )
  assert({
    given: 'handles spread over two pages plus one that matches nobody',
    should: 'check the org kind once, then sweep pages following the cursor',
    actual: asked,
    expected: [
      { method: 'auth.test', params: {} },
      { method: 'users.list', params: { limit: 200 } },
      { method: 'users.list', params: { limit: 200, cursor: 'page2' } },
      { method: 'users.list', params: { limit: 200, cursor: 'page3' } },
    ],
  })
  assert({
    given: 'the sweep results',
    should: 'map found handles and leave the miss absent',
    actual: [...names.entries()].sort(),
    expected: [
      ['alice', 'Alice Doe'],
      ['bob.smith', 'Bob'],
    ],
  })
})

test('resolveHandleNames: stops the sweep early once every handle is found', async () => {
  let listCalls = 0
  const names = await resolveHandleNames(['alice'], 'https://atlas.slack.com', async (_url, method) => {
    if (method === 'auth.test') return { ok: true }
    listCalls++
    return {
      ok: true,
      members: [{ id: 'U1', name: 'Alice', real_name: 'Alice Doe' }],
      response_metadata: { next_cursor: 'more' },
    }
  })
  assert({
    given: 'all handles found on page one (case-insensitively)',
    should: 'not fetch further pages',
    actual: { listCalls, name: names.get('alice') },
    expected: { listCalls: 1, name: 'Alice Doe' },
  })
  assert({
    given: 'no workspace url',
    should: 'resolve nothing without calling anything',
    actual: (await resolveHandleNames(['alice'])).size,
    expected: 0,
  })
})

test('resolveUsergroupNames: classic list maps wanted ids, preferring the handle', async () => {
  const called: string[] = []
  let edgeCalls = 0
  const names = await resolveUsergroupNames(
    ['S0123TEAMAB', 'S0456TEAMCD'],
    'https://atlas.slack.com',
    async (_url, method, params) => {
      called.push(`${method} ${JSON.stringify(params)}`)
      return groupsPayload
    },
    async () => {
      edgeCalls++
      return undefined
    },
  )
  assert({
    given: 'two wanted ids among three usergroups',
    should: 'map both, using handle when present and name otherwise',
    actual: [...names.entries()].sort(),
    expected: [
      ['S0123TEAMAB', 'atlas-core'],
      ['S0456TEAMCD', 'Atlas Ops Team'],
    ],
  })
  assert({
    given: 'a classic list that covered everything',
    should: 'make one disabled-inclusive call and never hit the edge API',
    actual: `${called.join('; ')} / edge: ${edgeCalls}`,
    expected: 'usergroups.list {"include_disabled":true} / edge: 0',
  })
})

test('resolveUsergroupNames: falls back to the edge cache under Enterprise Grid', async () => {
  let edgeArgs: unknown[] | undefined
  const names = await resolveUsergroupNames(
    ['S0123TEAMAB', 'S0999GONEXX'],
    'https://atlas.slack.com',
    async (_url, method) => {
      // Grid behavior: classic list is ok but empty; auth.test names the org
      if (method === 'usergroups.list') return { ok: true, usergroups: [] }
      if (method === 'auth.test') return { ok: true, enterprise_id: 'E0123ENTABC' }
      return undefined
    },
    async (...args) => {
      edgeArgs = args
      return {
        results: [{ id: 'S0123TEAMAB', handle: 'atlas-core', name: 'Atlas Core Team' }],
        failed_ids: ['S0999GONEXX'],
      }
    },
  )
  assert({
    given: 'an empty classic list and an enterprise id',
    should: 'ask the edge cache for exactly the missing ids',
    actual: edgeArgs,
    expected: ['https://atlas.slack.com', 'E0123ENTABC', 'usergroups/info', { ids: ['S0123TEAMAB', 'S0999GONEXX'] }],
  })
  assert({
    given: 'an edge result with one hit and one failed id',
    should: 'map the hit and leave the failure absent',
    actual: [...names.entries()],
    expected: [['S0123TEAMAB', 'atlas-core']],
  })
})

test('resolveUsergroupNames: degrades to an empty map', async () => {
  const blocked = await resolveUsergroupNames(
    ['S0123TEAMAB'],
    'https://atlas.slack.com',
    async () => undefined,
    async () => undefined,
  )
  assert({
    given: 'blocked classic and edge endpoints',
    should: 'return an empty map',
    actual: blocked.size,
    expected: 0,
  })
  let calls = 0
  await resolveUsergroupNames([], 'https://atlas.slack.com', async () => {
    calls++
    return groupsPayload
  })
  assert({
    given: 'no subteam ids to resolve',
    should: 'skip the API entirely',
    actual: calls,
    expected: 0,
  })
})
