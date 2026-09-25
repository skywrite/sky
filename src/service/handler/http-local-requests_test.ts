import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

const OTHER_SITE = {
  Origin: 'https://example.com',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
}
const JSON_BODY = { 'Content-Type': 'application/json' }

test('the app answers Sky pages and programs on this Mac, and refuses other sites before any route', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'http-local-requests-'))
  try {
    const notes = path.join(root, 'notes')
    await mkdir(notes, { recursive: true })
    const file = path.join(notes, 'atlas.md')
    await writeFile(file, '# Atlas\n')
    const app = createTestHttpApp([notes])
    const query = JSON.stringify({ query: '{ __typename }' })

    const refused = [
      await app.request(`http://localhost/graphql?query=${encodeURIComponent('{ __typename }')}`, {
        headers: OTHER_SITE,
      }),
      await app.request('http://localhost/graphql', {
        method: 'POST',
        headers: { ...JSON_BODY, ...OTHER_SITE },
        body: query,
      }),
      await app.request('http://localhost/graphql', {
        method: 'OPTIONS',
        headers: { ...OTHER_SITE, 'Access-Control-Request-Method': 'POST' },
      }),
      await app.request('http://localhost/docs/_api/content/notes/atlas.md', {
        method: 'PUT',
        headers: { ...JSON_BODY, ...OTHER_SITE },
        body: JSON.stringify({ content: '# Changed\n' }),
      }),
      await app.request('http://example.com/graphql', {
        method: 'POST',
        headers: { ...JSON_BODY, Origin: 'http://example.com', 'Sec-Fetch-Site': 'same-origin' },
        body: query,
      }),
    ]
    assert({
      given: 'reads, a write and a preflight from another site, and a request addressed to another name',
      should: 'refuse each with no cross-origin headers, leaving the file as it was',
      actual: [
        refused.map((response) => response.status),
        refused.map((response) => response.headers.get('access-control-allow-origin')),
        await readFile(file, 'utf8'),
      ],
      expected: [[403, 403, 403, 403, 403], [null, null, null, null, null], '# Atlas\n'],
    })

    const answered = [
      await app.request('http://localhost/graphql', { method: 'POST', headers: JSON_BODY, body: query }),
      await app.request('http://127.0.0.1:9999/graphql', { method: 'POST', headers: JSON_BODY, body: query }),
      await app.request('http://localhost/graphql', {
        method: 'POST',
        headers: { ...JSON_BODY, Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' },
        body: query,
      }),
      await app.request('http://localhost/docs/notes/atlas.md', {
        redirect: 'manual',
        headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
      }),
    ]
    assert({
      given: 'a program on this Mac, the loopback address, a Sky page, and a link on another site',
      should: 'reach their routes',
      actual: answered.map((response) => response.status),
      expected: [200, 200, 200, 302],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
