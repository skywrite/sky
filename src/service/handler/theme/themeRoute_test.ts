import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { createTestHttpApp } from '../httpTestHelpers.ts'

async function withApp<T>(run: (app: ReturnType<typeof createTestHttpApp>) => Promise<T>): Promise<T> {
  const testDir = await mkdtemp(path.join(os.tmpdir(), 'theme-route-'))
  const notesDir = path.join(testDir, 'notes')
  await mkdir(notesDir, { recursive: true })
  try {
    return await run(createTestHttpApp([notesDir]))
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
}

test({ name: 'app shell - serves the client at /' }, async () => {
  await withApp(async (app) => {
    const response = await app.request('http://localhost/')
    const html = await response.text()

    assert({
      given: 'a request for /',
      should: 'return 200',
      actual: response.status,
      expected: 200,
    })

    assert({
      given: 'the app shell',
      should: 'mount the client app, load its assets, and carry the app title',
      actual:
        html.includes('id="root"') &&
        html.includes('/_assets/main.js') &&
        html.includes('/_assets/main.css') &&
        html.includes('<title>sky</title>'),
      expected: true,
    })

    const retired = await app.request('http://localhost/theme')
    assert({
      given: 'the retired /theme path',
      should: 'return 404',
      actual: retired.status,
      expected: 404,
    })
  })
})

test({ name: 'theme assets - Bun-built bundle serves js and css' }, async () => {
  await withApp(async (app) => {
    const js = await app.request('http://localhost/_assets/main.js')
    const jsBody = await js.text()

    assert({
      given: 'the bundled client js',
      should: 'serve a substantial bundle with 200',
      actual: js.status === 200 && jsBody.length > 100_000,
      expected: true,
    })

    assert({
      given: 'the same bundle',
      should: 'carry the live chat — the client of the /chat routes',
      actual: jsBody.includes('/messages') && jsBody.includes('/day'),
      expected: true,
    })

    const css = await app.request('http://localhost/_assets/main.css')
    const cssBody = await css.text()

    assert({
      given: 'the bundled css',
      should: 'include Mantine styles and the shell',
      actual: css.status === 200 && cssBody.includes('--mantine-') && cssBody.includes('.sky-'),
      expected: true,
    })

    const missing = await app.request('http://localhost/_assets/nope.js')
    assert({
      given: 'an unknown asset name',
      should: 'return 404',
      actual: missing.status,
      expected: 404,
    })
  })
})
