import { assert, test } from '#test'
import { createWebTools } from './webTools.ts'

const PAGE = 'https://example.com/report'
const html = (text: string) => new Response(text, { headers: { 'content-type': 'text/html' } })

test('web_fetch retains HTML beyond five megabytes and reads its last section', async () => {
  let requests = 0
  const source = `<p>${'Opening evidence. '.repeat(350_000)}</p><h2 id="conclusion">Conclusion</h2><p>The final evidence is retained.</p>`
  const tools = createWebTools({
    pageFetcher: async () => {
      requests++
      return html(source)
    },
  })
  const first = await tools.web_fetch.execute({ url: PAGE })
  const section = await tools.web_fetch.execute({ url: PAGE + '#conclusion' })
  if (!first.ok || !section.ok) throw new Error('Expected complete page retention')
  const ending = 'The final evidence is retained.'
  const tail = await tools.web_fetch.execute({
    url: PAGE,
    offsetBytes: first.totalBytes - Buffer.byteLength(ending),
    snapshot: first.snapshot,
  })
  if (!tail.ok) throw new Error(tail.error)
  assert({
    given: 'an HTML page larger than the former five-megabyte download ceiling',
    should: 'retain its full Markdown and expose both the last bytes and the last section from one download',
    actual: [
      requests,
      first.totalBytes > 6_000_000,
      first.returnedBytes,
      first.downloadTruncated,
      section.text,
      section.truncated,
      tail.text,
      tail.truncated,
    ],
    expected: [1, true, 20_000, false, '## Conclusion\n\nThe final evidence is retained.', false, ending, false],
  })
})

test('web_fetch does not cache an interrupted response as a complete page', async () => {
  let requests = 0
  const tools = createWebTools({
    pageFetcher: async () => {
      requests++
      if (requests > 1) return new Response('The complete page.')
      let reads = 0
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (reads++ === 0) controller.enqueue(new TextEncoder().encode('Only the beginning.'))
            else controller.error(new Error('Connection closed before the response ended'))
          },
        }),
      )
    },
  })
  const failed = await tools.web_fetch.execute({ url: PAGE })
  const retried = await tools.web_fetch.execute({ url: PAGE })
  assert({
    given: 'a response stream that fails after sending some text',
    should: 'report failure and allow a complete retry without retaining the broken prefix',
    actual: [failed.ok, requests, retried.ok ? retried.text : retried.error],
    expected: [false, 2, 'The complete page.'],
  })
})

test('web_fetch reads a long page completely through cached Unicode-safe continuations', async () => {
  let requests = 0
  const source = 'a'.repeat(19_999) + '🧭' + 'more evidence\n'.repeat(4000) + 'Final conclusion.'
  const tools = createWebTools({
    pageFetcher: async () => {
      requests++
      return new Response(source)
    },
  })
  let result = await tools.web_fetch.execute({ url: PAGE })
  const pieces: string[] = []
  const offsets: number[] = []
  while (true) {
    if (!result.ok) throw new Error(result.error)
    pieces.push(result.text)
    offsets.push(result.offsetBytes)
    if (!result.next) break
    result = await tools.web_fetch.execute(result.next)
  }
  assert({
    given: 'a document longer than three excerpts with an emoji across the first boundary',
    should: 'recover every byte once, end with complete coverage, and fetch the page only once',
    actual: [pieces.join(''), requests, offsets[1], result.totalBytes, result.truncated, result.downloadTruncated],
    expected: [source, 1, 19_999, Buffer.byteLength(source), false, false],
  })
})

test('web_fetch preserves document structure and resolves source links', async () => {
  const tools = createWebTools({
    pageFetcher: async () =>
      html(`
    <html><head><title>Atlas report</title><base href="/docs/"></head><body>
    <script>ignore this script</script><style>ignore this style</style>
    <h1>Atlas &amp; Widgets</h1><p>First paragraph.</p><p>Second paragraph.</p>
    <ul><li>One</li><li>Two</li></ul><ol><li>Step one</li><li>Step two</li></ol>
    <table><tr><th>Item</th><th>Count</th></tr><tr><td>Widget</td><td>3</td></tr></table>
    <p><a href="details">Details</a></p><pre><code>one\n  two</code></pre>
    </body></html>`),
  })
  const result = await tools.web_fetch.execute({ url: PAGE })
  if (!result.ok) throw new Error(result.error)
  assert({
    given: 'HTML containing headings, paragraphs, lists, a table, code, and a relative link',
    should: 'preserve readable Markdown and link destinations without script or style text',
    actual: [
      result.title,
      result.text.includes('# Atlas & Widgets'),
      result.text.includes('First paragraph.\n\nSecond paragraph.'),
      result.text.includes('- One\n- Two'),
      /1\. Step one\n2\. Step two/.test(result.text),
      /\|\s*Item\s*\|\s*Count\s*\|/.test(result.text),
      /\|\s*Widget\s*\|\s*3\s*\|/.test(result.text),
      result.text.includes('[Details](https://example.com/docs/details)'),
      result.text.includes('one\n  two'),
      result.text.includes('ignore this'),
    ],
    expected: ['Atlas report', true, true, true, true, true, true, true, true, false],
  })
})

test('web_fetch selects late containers, heading ranges, and named anchors from one download', async () => {
  const requested: string[] = []
  const tools = createWebTools({
    pageFetcher: async (url) => {
      requested.push(url)
      return html(`<p>${'Opening text. '.repeat(3000)}</p>
      <section id="late"><h2>Late chapter</h2><p>The late evidence.</p></section>
      <h2 id="analysis">Analysis</h2><p>Analysis evidence.</p><h3>Details</h3><p>Nested evidence.</p>
      <h2 id="next">Next chapter</h2><p>Next evidence.</p>
      <a name="legacy"></a><h2>Legacy chapter</h2><p>Legacy evidence.</p>
      <h2 id="final résumé">Final chapter</h2><p>Final evidence.</p>`)
    },
  })
  const results = await Promise.all(
    ['', '#late', '#analysis', '#legacy', '#final%20r%C3%A9sum%C3%A9'].map((fragment) =>
      tools.web_fetch.execute({ url: PAGE + fragment }),
    ),
  )
  for (const result of results) if (!result.ok) throw new Error(result.error)
  const [full, late, analysis, legacy, final] = results
  if (!full.ok || !late.ok || !analysis.ok || !legacy.ok || !final.ok) throw new Error('unreachable')
  assert({
    given: 'several concurrent fragment reads beyond the old cutoff',
    should: 'share one fetch and select the requested sections including nested headings',
    actual: [
      requested,
      full.truncated,
      late.text,
      analysis.text,
      legacy.text,
      final.text,
      late.truncated,
      late.pageTotalBytes > late.totalBytes,
      full.sections.map((section) => section.id),
    ],
    expected: [
      [PAGE],
      true,
      '## Late chapter\n\nThe late evidence.',
      '## Analysis\n\nAnalysis evidence.\n\n### Details\n\nNested evidence.',
      '## Legacy chapter\n\nLegacy evidence.',
      '## Final chapter\n\nFinal evidence.',
      false,
      true,
      ['late', 'analysis', 'next', 'legacy', 'final résumé'],
    ],
  })
})

test('web_fetch continues within a selected section and reports missing sections explicitly', async () => {
  let requests = 0
  const text = 'Evidence. '.repeat(3000)
  const tools = createWebTools({
    pageFetcher: async () => {
      requests++
      return html(`<section id="long"><p>${text}</p></section><section id="other">Other evidence.</section>`)
    },
  })
  const first = await tools.web_fetch.execute({ url: PAGE + '#long' })
  if (!first.ok || !first.next) throw new Error('Expected a continuation')
  const last = await tools.web_fetch.execute(first.next)
  const missing = await tools.web_fetch.execute({ url: PAGE + '#missing' })
  if (!last.ok || missing.ok) throw new Error('Unexpected result')
  assert({
    given: 'a long selected section and a nonexistent fragment on the same page',
    should: 'finish only the selected section and offer real anchors instead of repeating the opening',
    actual: [
      first.text + last.text,
      last.truncated,
      first.next.url,
      requests,
      missing.code,
      missing.sections?.map((section) => section.id),
    ],
    expected: [text.trim(), false, PAGE + '#long', 1, 'section_not_found', ['long', 'other']],
  })
})

test('web_fetch validates continuation positions and snapshot identity', async () => {
  let requests = 0
  const tools = createWebTools({
    pageFetcher: async () => {
      requests++
      return new Response('🧭' + 'a'.repeat(30_000))
    },
  })
  const initial = await tools.web_fetch.execute({ url: PAGE, offsetBytes: 20_000 })
  const first = await tools.web_fetch.execute({ url: PAGE })
  if (!first.ok) throw new Error(first.error)
  const bad = await Promise.all([
    tools.web_fetch.execute({ url: PAGE, offsetBytes: 1 }),
    tools.web_fetch.execute({ url: PAGE, offsetBytes: 100_000 }),
    tools.web_fetch.execute({ url: PAGE, offsetBytes: -1 }),
    tools.web_fetch.execute({ url: PAGE, offsetBytes: 0.5 }),
    tools.web_fetch.execute({ url: PAGE, snapshot: 'another-snapshot' }),
  ])
  assert({
    given: 'an uncached continuation, invalid UTF-8 positions, and a stale snapshot',
    should: 'refuse each without downloading replacement content or returning corrupt text',
    actual: [initial.ok ? 'ok' : initial.code, bad.map((result) => (result.ok ? 'ok' : result.code)), requests],
    expected: [
      'cache_miss',
      ['invalid_offset', 'invalid_offset', 'invalid_offset', 'invalid_offset', 'snapshot_changed'],
      1,
    ],
  })
})

test('web_fetch retries a failed download and resolves links against redirect destinations', async () => {
  let calls = 0
  const tools = createWebTools({
    pageFetcher: async (url) => {
      calls++
      if (calls === 1) return new Response('Unavailable', { status: 503 })
      if (url === PAGE) return new Response(null, { status: 302, headers: { location: '/final/index.html' } })
      return html('<p><a href="details.html">Details</a></p>')
    },
  })
  const failed = await tools.web_fetch.execute({ url: PAGE })
  const retried = await tools.web_fetch.execute({ url: PAGE })
  if (failed.ok || !retried.ok) throw new Error('Unexpected result')
  assert({
    given: 'a temporary HTTP failure followed by a redirect',
    should: 'avoid caching failure and retain the final source URL with absolute links',
    actual: [failed.error.includes('503'), calls, retried.url, retried.text],
    expected: [true, 3, 'https://example.com/final/index.html', '[Details](https://example.com/final/details.html)'],
  })
})

test('web_fetch stops unsafe redirects and propagates user cancellation', async () => {
  let calls = 0
  const tools = createWebTools({
    pageFetcher: async () => {
      calls++
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
    },
  })
  const result = await tools.web_fetch.execute({ url: PAGE })
  const abort = new AbortController()
  abort.abort(new Error('Stopped by user'))
  let message = ''
  try {
    await tools.web_fetch.execute({ url: PAGE }, { abortSignal: abort.signal })
  } catch (error) {
    message = (error as Error).message
  }
  assert({
    given: 'a redirect into a private network and a cancelled read',
    should: 'fetch no private destination and propagate cancellation',
    actual: [result.ok, calls, message],
    expected: [false, 1, 'Stopped by user'],
  })
})
