import { assert, test } from '#test'
import { WebPageError } from './pageContent.ts'
import { createWebPageReader } from './pageReader.ts'
import { readWebBody } from './readBody.ts'

const signal = new AbortController().signal

test('redirect destinations can continue the same cached snapshot', async () => {
  let requests = 0
  const reader = createWebPageReader(async () => {
    requests++
    return {
      url: 'https://example.com/final',
      text: 'The complete evidence.',
      contentType: 'text/plain',
      truncated: false,
    }
  })
  const first = await reader({ url: 'https://example.com/original' }, 5, signal)
  const last = await reader({ ...first.next!, url: first.url }, 100, signal)
  assert({
    given: 'a continuation using the source URL returned after a redirect',
    should: 'reuse the original snapshot and avoid downloading it again',
    actual: [requests, first.text + last.text, last.snapshot === first.snapshot],
    expected: [1, 'The complete evidence.', true],
  })
})

test('page snapshots are bounded and an evicted continuation never silently refetches', async () => {
  let requests = 0
  const reader = createWebPageReader(async (url) => {
    requests++
    return { url, text: 'Some evidence.', contentType: 'text/plain', truncated: false }
  }, 1)
  const first = await reader({ url: 'https://example.com/one' }, 5, signal)
  await reader({ url: 'https://example.com/two' }, 5, signal)
  let code = ''
  try {
    await reader(first.next!, 5, signal)
  } catch (error) {
    if (error instanceof WebPageError) code = error.code
  }
  assert({
    given: 'a continuation for a page evicted from a bounded cache',
    should: 'require a fresh read without mixing document versions',
    actual: [code, requests],
    expected: ['cache_miss', 2],
  })
})

test('download and excerpt limits are reported separately, including exact-size responses', async () => {
  const outcomes: unknown[] = []
  for (const source of ['aaaa🧭', 'aaaa🧭extra']) {
    const reader = createWebPageReader(async (url) => ({
      url,
      contentType: 'text/plain',
      ...(await readWebBody(new Response(source), 8, signal)),
    }))
    const first = await reader({ url: 'https://example.com/report' }, 4, signal)
    const last = await reader(first.next!, 4, signal)
    outcomes.push([
      first.text + last.text,
      first.truncated,
      last.truncated,
      last.downloadTruncated,
      last.nextOffsetBytes,
      last.totalBytes,
    ])
  }
  assert({
    given: 'one response exactly at the download limit and another exceeding it',
    should: 'finish the first normally and report the second as incomplete even after its cached text is exhausted',
    actual: outcomes,
    expected: [
      ['aaaa🧭', true, false, false, undefined, 8],
      ['aaaa🧭', true, true, true, undefined, 8],
    ],
  })
})
