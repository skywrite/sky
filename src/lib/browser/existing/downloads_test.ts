import { assert, test } from '#test'
import type { PageProtocol } from './connection.ts'
import { captureDownloadResponse, type DownloadResponse } from './downloads.ts'

function fixture(resourceType: string, contentType: string, disposition = 'attachment; filename="Atlas.txt"') {
  const commands: string[] = []
  const saved: { name: string; body: string }[] = []
  const protocol = {
    send: async (method: string) => {
      commands.push(method)
      if (method === 'Fetch.takeResponseBodyAsStream') return { stream: 'synthetic-stream' }
      if (method === 'IO.read') return { data: 'Synthetic content', eof: true }
      return {}
    },
  } as PageProtocol
  const event: DownloadResponse = {
    requestId: 'synthetic-request',
    request: { url: 'https://atlas.example/resource' },
    responseStatusCode: 200,
    responseHeaders: [
      { name: 'content-type', value: contentType },
      { name: 'content-disposition', value: disposition },
    ],
    resourceType,
  }
  return {
    commands,
    saved,
    capture: () =>
      captureDownloadResponse(protocol, event, async (name, bytes) => {
        saved.push({ name, body: bytes.toString() })
      }),
  }
}

test('attachment headers on page resources do not turn scripts, styles or data into downloads', async () => {
  for (const [resource, type] of [
    ['Script', 'application/javascript'],
    ['Stylesheet', 'text/css'],
    ['XHR', 'application/json'],
    ['Fetch', 'application/json'],
    ['Image', 'image/png'],
    ['Font', 'font/woff2'],
    ['Other', 'application/octet-stream'],
  ]) {
    const f = fixture(resource, type)
    assert({
      given: `a ${resource} response with Content-Disposition: attachment`,
      should: 'leave the response intact for Chromium to load into the page',
      actual: [await f.capture(), f.commands, f.saved],
      expected: [false, [], []],
    })
  }
})

test('document attachments and inline PDF navigations still become task downloads', async () => {
  for (const [type, disposition, name] of [
    ['text/plain', 'attachment; filename="Atlas.txt"', 'Atlas.txt'],
    ['application/pdf', 'inline; filename="Atlas.pdf"', 'Atlas.pdf'],
  ]) {
    const f = fixture('Document', type, disposition)
    assert({
      given: `a ${type} document response`,
      should: 'save its bytes and release the intercepted response',
      actual: [await f.capture(), f.saved, f.commands],
      expected: [
        true,
        [{ name, body: 'Synthetic content' }],
        ['Fetch.takeResponseBodyAsStream', 'IO.read', 'IO.close', 'Fetch.failRequest'],
      ],
    })
  }
  const inline = fixture('Document', 'text/html', 'inline')
  assert({
    given: 'an ordinary HTML document',
    should: 'remain a page',
    actual: [await inline.capture(), inline.commands],
    expected: [false, []],
  })
})
