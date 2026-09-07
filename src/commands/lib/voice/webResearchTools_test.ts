import { assert, test } from '#test'
import type { ResearchFetch, ResearchTrace } from './researchTools.ts'
import { createVoiceWebTools, type WebResearchTrace } from './webResearchTools.ts'

const EXECUTION = { toolCallId: 'web-test', messages: [], context: {} }
const PAGE = 'https://example.com/article'
type Result = {
  ok: boolean
  code?: string
  text?: string
  url?: string
  empty?: boolean
  results?: unknown[]
  truncated?: boolean
  offsetBytes?: number
  nextOffsetBytes?: number
}
function setup(
  fetcher: ResearchFetch,
  overrides: {
    apiKey?: string
    question?: string
    maxBytes?: number
    chunkBytes?: number
    maxDownloadBytes?: number
    signal?: AbortSignal
  } = {},
) {
  const trace: ResearchTrace = { paths: new Set(), searches: 0, failures: 0, bytes: 0, calls: 0 }
  const webTrace: WebResearchTrace = {
    candidates: new Set(),
    attempted: new Set(),
    urls: new Set(),
    errors: new Set(),
    downloadedBytes: 0,
  }
  const tools = createVoiceWebTools({
    apiKey: 'mock-api-key',
    question: `Read ${PAGE}`,
    signal: new AbortController().signal,
    trace,
    webTrace,
    fetcher,
    maxCalls: 8,
    maxBytes: 24_000,
    chunkBytes: 12_000,
    maxDownloadBytes: 2_000_000,
    ...overrides,
  })
  return { tools, trace, webTrace }
}

test('voice web tools distinguish configuration, auth, provider, malformed, and empty search results', async () => {
  const outcomes: unknown[] = []
  for (const kind of ['missing', 'auth', 'provider', 'invalid', 'empty']) {
    let calls = 0
    const state = setup(
      async () => {
        calls++
        return kind === 'auth'
          ? new Response('', { status: 401 })
          : kind === 'provider'
            ? new Response('', { status: 503 })
            : kind === 'invalid'
              ? Response.json({ wrong: [] })
              : Response.json({ results: [] })
      },
      { apiKey: kind === 'missing' ? undefined : 'mock-api-key' },
    )
    const result = (await state.tools.web_search.execute!({ query: 'public example' }, EXECUTION)) as Result
    outcomes.push([kind, result.ok, result.code, result.empty, calls, [...state.webTrace.urls]])
  }
  assert({
    given: 'different retrieval outcomes',
    should: 'preserve the actual condition without empty-array fallbacks',
    actual: outcomes,
    expected: [
      ['missing', false, 'missing_key', undefined, 0, []],
      ['auth', false, 'authentication', undefined, 1, []],
      ['provider', false, 'provider_unavailable', undefined, 1, []],
      ['invalid', false, 'invalid_response', undefined, 1, []],
      ['empty', true, undefined, true, 1, []],
    ],
  })
})

test('voice web search bounds results and page reads establish final URL evidence', async () => {
  let request: unknown
  const state = setup(async (url, init) => {
    if (url.endsWith('/search')) {
      request = JSON.parse(String(init?.body))
      return Response.json({
        results: Array.from({ length: 8 }, (_, i) => ({
          title: `Public report ${i}`,
          url: `https://example.com/report-${i}`,
          snippet: 's'.repeat(2000),
          date: '2026-01-03',
        })),
      })
    }
    if (url.endsWith('/report-0')) return new Response(null, { status: 302, headers: { location: '/final-report' } })
    return new Response(
      '<html><script>private script data</script><main>Public &amp; verified &#x1F9ED;.</main></html>',
      { headers: { 'content-type': 'text/html' } },
    )
  })
  const search = (await state.tools.web_search.execute!({ query: 'public report' }, EXECUTION)) as Result
  const afterSearch = [...state.webTrace.urls]
  const read = (await state.tools.read_web_page.execute!({ url: 'https://example.com/report-0' }, EXECUTION)) as Result
  assert({
    given: 'eight search candidates and a readable redirected page',
    should: 'return five leads, then record only the fetched source URL',
    actual: [request, search.results?.length, afterSearch, read.text, read.url, [...state.webTrace.urls]],
    expected: [
      { query: 'public report', max_results: 5, max_tokens: 4000, max_tokens_per_page: 1000 },
      5,
      [],
      'Public & verified 🧭.',
      'https://example.com/final-report',
      ['https://example.com/final-report'],
    ],
  })
})

test('voice web reads reject unknown URLs and unsafe redirects before fetching a destination', async () => {
  const requests: string[] = []
  const state = setup(async (url) => {
    requests.push(url)
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } })
  })
  const unknown = (await state.tools.read_web_page.execute!(
    { url: 'https://example.org/unrequested' },
    EXECUTION,
  )) as Result
  const redirect = (await state.tools.read_web_page.execute!({ url: PAGE }, EXECUTION)) as Result
  assert({
    given: 'an unrequested public URL and a known page redirecting to loopback',
    should: 'block both without sending the second network request or claiming source evidence',
    actual: [unknown.code, redirect.code, requests, [...state.webTrace.urls], state.trace.bytes],
    expected: ['unsafe_url', 'unsafe_url', [PAGE], [], 0],
  })
})

test('voice web reads distinguish blocked, unsupported, empty, and unavailable pages', async () => {
  const results: unknown[] = []
  for (const kind of ['blocked', 'unsupported', 'encoded', 'empty', 'unavailable']) {
    const state = setup(async () =>
      kind === 'blocked'
        ? new Response('', { status: 403 })
        : kind === 'unsupported'
          ? new Response('pdf', { headers: { 'content-type': 'application/pdf' } })
          : kind === 'encoded'
            ? new Response('compressed bytes', { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } })
            : kind === 'empty'
              ? new Response('<script>app()</script>', { headers: { 'content-type': 'text/html' } })
              : new Response('', { status: 500 }),
    )
    const result = (await state.tools.read_web_page.execute!({ url: PAGE }, EXECUTION)) as Result
    results.push([result.code, state.trace.bytes, [...state.webTrace.urls]])
  }
  assert({
    given: 'pages that do not supply readable evidence',
    should: 'return specific failures and release reserved evidence bytes',
    actual: results,
    expected: [
      ['page_blocked', 0, []],
      ['unsupported_content', 0, []],
      ['unsupported_content', 0, []],
      ['empty_page', 0, []],
      ['page_unavailable', 0, []],
    ],
  })
})

test('voice web reads cap downloaded and evidence bytes without splitting UTF-8 characters', async () => {
  let cancelled = false
  const state = setup(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('aaa🧭' + 'x'.repeat(100)))
          },
          cancel() {
            cancelled = true
          },
        }),
        { headers: { 'content-type': 'text/plain' } },
      ),
    { maxBytes: 5, chunkBytes: 5, maxDownloadBytes: 20 },
  )
  const result = (await state.tools.read_web_page.execute!({ url: PAGE }, EXECUTION)) as Result
  assert({
    given: 'a long open stream and a four-byte character at the evidence boundary',
    should: 'cancel after the download cap and preserve complete evidence characters',
    actual: [result.text, result.truncated, state.trace.bytes, state.webTrace.downloadedBytes, cancelled],
    expected: ['aaa', true, 3, 20, true],
  })
})

test('voice web cancellation aborts the network call and is not converted into search failure', async () => {
  const controller = new AbortController()
  const state = setup(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        controller.abort(new Error('User ended the call'))
      }),
    { signal: controller.signal },
  )
  let message = ''
  try {
    await state.tools.web_search.execute!({ query: 'public topic' }, EXECUTION)
  } catch (error) {
    message = (error as Error).message
  }
  assert({
    given: 'the user ending an in-flight web search',
    should: 'propagate cancellation without reporting an empty result or provider failure',
    actual: [message, [...state.webTrace.errors]],
    expected: ['User ended the call', []],
  })
})

test('parallel voice page reads share the download cap without counting the same allowance twice', async () => {
  const secondPage = 'https://example.com/second'
  const state = setup(async () => new Response('x'.repeat(20), { headers: { 'content-type': 'text/plain' } }), {
    question: `Read ${PAGE} and ${secondPage}`,
    maxBytes: 100,
    chunkBytes: 50,
    maxDownloadBytes: 20,
  })
  const results = (await Promise.all([
    state.tools.read_web_page.execute!({ url: PAGE }, EXECUTION),
    state.tools.read_web_page.execute!({ url: secondPage }, EXECUTION),
  ])) as Result[]
  assert({
    given: 'two concurrent twenty-byte page reads and a shared twenty-byte download limit',
    should: 'retain at most twenty bytes and report the competing read as budget-limited, not an empty page',
    actual: [
      state.webTrace.downloadedBytes,
      state.trace.bytes,
      results.filter((result) => result.ok).map((result) => result.text),
      results.filter((result) => !result.ok).map((result) => result.code),
      state.webTrace.urls.size,
    ],
    expected: [20, 20, ['x'.repeat(20)], ['budget'], 1],
  })
})

test('voice web reads continue cached UTF-8 excerpts after the download allowance is exhausted', async () => {
  let requests = 0
  const source = 'aaa🧭bbb more evidence'
  const state = setup(
    async () => {
      requests++
      return new Response(source, { headers: { 'content-type': 'text/plain' } })
    },
    { maxBytes: 100, chunkBytes: 5, maxDownloadBytes: Buffer.byteLength(source) },
  )
  const chunks: string[] = []
  let offsetBytes: number | undefined = 0
  while (offsetBytes !== undefined) {
    const result = (await state.tools.read_web_page.execute!({ url: PAGE, offsetBytes }, EXECUTION)) as Result
    if (!result.ok) throw new Error(result.code)
    chunks.push(result.text!)
    offsetBytes = result.nextOffsetBytes
  }
  assert({
    given: 'a relevant passage beyond the first five-byte excerpt, with a Unicode boundary and no download budget left',
    should: 'read successive cached excerpts without splitting characters or fetching the same page again',
    actual: [chunks.join(''), requests, state.trace.bytes, state.webTrace.downloadedBytes, [...state.webTrace.urls]],
    expected: [source, 1, Buffer.byteLength(source), Buffer.byteLength(source), [PAGE]],
  })
})
