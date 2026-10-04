import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { createYogaInstance } from '../graphql/schema.ts'
import { Store } from '../store.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/graphql-response+json',
}
const SAVE_DOCUMENT = `mutation Save($path: String!, $content: String!) {
  saveDocument(path: $path, content: $content) { saved }
}`

async function withNotebook(run: (app: ReturnType<typeof createTestHttpApp>, file: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'http-graphql-'))
  try {
    const notes = path.join(root, 'notes')
    await mkdir(notes)
    const file = path.join(notes, 'atlas.md')
    await writeFile(file, '# Atlas\n')
    const store = new Store()
    const yoga = createYogaInstance(store, null, { baseDir: root, dirs: [notes] })
    await run(createTestHttpApp([notes], { store, yoga }), file)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function streamedJson(payload: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close()
        return
      }
      const end = Math.min(offset + 17, bytes.length)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    },
  })
}

test('GraphQL HTTP accepts native streamed requests with variables and a selected operation', async () => {
  await withNotebook(async (app) => {
    const response = await app.fetch(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: { ...JSON_HEADERS, Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' },
        body: streamedJson({
          query: `query Other { __typename }
            query Read($path: String!) { documentContent(path: $path) { path content } }`,
          operationName: 'Read',
          variables: { path: 'notes/atlas.md' },
        }),
      }),
    )
    assert({
      given: 'a same-origin JSON stream without Content-Length passing through Hono to real Yoga',
      should: 'execute the selected query with its variables and leave CORS to the app',
      actual: [response.status, await response.json(), response.headers.get('access-control-allow-origin')],
      expected: [200, { data: { documentContent: { path: 'notes/atlas.md', content: '# Atlas\n' } } }, null],
    })
  })
})

test('GraphQL HTTP keeps parse, validation and document errors useful and recovers for the next request', async () => {
  await withNotebook(async (app) => {
    const results: { status: number; payload: { errors: { message: string }[] } }[] = []
    for (const query of ['{', '{ unknownField }', '{ documentContent(path: "../outside.md") { content } }']) {
      const response = await app.request('http://localhost/graphql', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ query }),
      })
      results.push({ status: response.status, payload: await response.json() })
    }
    assert({
      given: 'invalid syntax, an unknown field, and a document outside the notebook',
      should: 'report request errors separately from execution errors and preserve their explanations',
      actual: [
        results.map((result) => result.status),
        results[0]!.payload.errors[0].message.startsWith('Syntax Error:'),
        results[1]!.payload.errors[0].message.includes('unknownField'),
        results[2]!.payload.errors[0].message,
      ],
      expected: [[400, 400, 200], true, true, 'Requested file is outside the notebook base directory'],
    })

    const response = await app.request('http://localhost/graphql', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ query: '{ tags }' }),
    })
    assert({
      given: 'a valid request after rejected requests',
      should: 'still return notebook data',
      actual: [response.status, await response.json()],
      expected: [200, { data: { tags: [] } }],
    })
  })
})

test('GraphQL HTTP refuses GET mutations and foreign-origin saves without changing the document', async () => {
  await withNotebook(async (app, file) => {
    const variables = { path: 'notes/atlas.md', content: '# Changed\n' }
    const params = new URLSearchParams({ query: SAVE_DOCUMENT, variables: JSON.stringify(variables) })
    const getResponse = await app.request(`http://localhost/graphql?${params}`, {
      headers: { Accept: JSON_HEADERS.Accept },
    })
    const getPayload = await getResponse.json()
    assert({
      given: 'a document-save mutation sent over GET',
      should: 'reject it and leave the file untouched',
      actual: [getResponse.status, getPayload.errors.length > 0, await readFile(file, 'utf8')],
      expected: [405, true, '# Atlas\n'],
    })

    const postResponse = await app.request('http://localhost/graphql', {
      method: 'POST',
      headers: { ...JSON_HEADERS, Origin: 'https://example.com', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ query: SAVE_DOCUMENT, variables }),
    })
    assert({
      given: 'a real Yoga document-save request from another site',
      should: 'refuse the save before execution without cross-origin response headers',
      actual: [
        postResponse.status,
        postResponse.headers.get('access-control-allow-origin'),
        await readFile(file, 'utf8'),
      ],
      expected: [403, null, '# Atlas\n'],
    })
  })
})

test('GraphQL HTTP rejects a declared body over 25 MB before reading it', async () => {
  await withNotebook(async (app, file) => {
    let bodyRead = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          bodyRead = true
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ query: '{ tags }' })))
          controller.close()
        },
      },
      { highWaterMark: 0 },
    )
    const response = await app.fetch(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Content-Length': '25000001' },
        body,
      }),
    )
    const payload = await response.json()
    assert({
      given: 'a request declaring more than Yoga’s default 25 MB limit',
      should: 'return a useful 413 before consuming the body or changing documents',
      actual: [response.status, payload.errors[0].message, bodyRead, await readFile(file, 'utf8')],
      expected: [413, 'Request body too large', false, '# Atlas\n'],
    })
    await body.cancel()
  })
})

test('GraphQL HTTP enforces the body limit on streams with missing or understated Content-Length', async () => {
  await withNotebook(async (app, file) => {
    const prefix = new TextEncoder().encode(
      JSON.stringify({
        query: SAVE_DOCUMENT,
        variables: { path: 'notes/atlas.md', content: '# Changed\n' },
      }),
    )
    const padding = new Uint8Array(1_000_000).fill(32)
    for (const contentLength of [undefined, '1']) {
      let chunk = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunk === 0) controller.enqueue(prefix)
          else if (chunk <= 26) controller.enqueue(padding)
          else controller.close()
          chunk++
        },
      })
      const headers = new Headers(JSON_HEADERS)
      if (contentLength) headers.set('Content-Length', contentLength)
      const response = await app.fetch(new Request('http://localhost/graphql', { method: 'POST', headers, body }))
      const payload = await response.json()
      assert({
        given: `a valid save request padded beyond 25 MB with Content-Length ${contentLength ?? 'missing'}`,
        should: 'reject the stream before executing the save',
        actual: [response.status, payload.errors[0].message, await readFile(file, 'utf8')],
        expected: [413, 'Request body too large', '# Atlas\n'],
      })
    }
  })
})
