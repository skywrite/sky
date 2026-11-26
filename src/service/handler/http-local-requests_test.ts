import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { fromTailnet } from './localRequest.ts'

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

test('the owner’s phone through tailscale serve reads and saves; anyone else on the tailnet is refused', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'http-tailnet-requests-'))
  try {
    const notes = path.join(root, 'notes')
    await mkdir(notes, { recursive: true })
    const file = path.join(notes, 'atlas.md')
    await writeFile(file, '# Atlas\n')
    const app = createTestHttpApp([notes])
    const tailnet = { host: 'atlas-mac.tail-example.ts.net', login: 'jane@example.com' }
    // As `tailscale serve` hands a request to Sky: the Mac's tailnet name over plain HTTP, and the requester's login.
    const served = (login: string, address: string, init: RequestInit = {}) =>
      fromTailnet(
        new Request(`http://${tailnet.host}${address}`, {
          ...init,
          headers: {
            Origin: `https://${tailnet.host}`,
            'Sec-Fetch-Site': 'same-origin',
            'Tailscale-User-Login': login,
            ...(init.headers as Record<string, string> | undefined),
          },
        }),
        tailnet,
      )
    const read = await app.request(served(tailnet.login, '/docs/_api/content/notes/atlas.md'))
    const { version } = (await read.clone().json()) as { version: string }
    const save = (login: string) =>
      app.request(
        served(login, '/docs/_api/content/notes/atlas.md', {
          method: 'PUT',
          headers: JSON_BODY,
          body: JSON.stringify({ content: '# Atlas, from the phone\n', version }),
        }),
      )
    const stranger = await save('joe@example.com')
    const afterStranger = await readFile(file, 'utf8')
    const owner = await save(tailnet.login)
    assert({
      given: 'a read and a save from the owner’s phone, and a save from another person on the tailnet',
      should: 'answer the owner both times and refuse the other person before the file changes',
      actual: [read.status, stranger.status, afterStranger, owner.status, await readFile(file, 'utf8')],
      expected: [200, 403, '# Atlas\n', 200, '# Atlas, from the phone\n'],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
