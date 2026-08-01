import * as os from 'node:os'
import * as path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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

test({ name: 'theme route - serves the style guide shell' }, async () => {
  await withApp(async (app) => {
    const response = await app.request('http://localhost/theme')
    const html = await response.text()

    assert({
      given: 'a request for /theme',
      should: 'return 200',
      actual: response.status,
      expected: 200,
    })

    assert({
      given: 'the /theme shell',
      should: 'mount the client app and load its assets',
      actual: html.includes('id="root"') && html.includes('/_assets/main.js') && html.includes('/_assets/main.css'),
      expected: true,
    })

    const canvas = await app.request('http://localhost/')
    const canvasHtml = await canvas.text()

    assert({
      given: 'the blank canvas at /',
      should: 'serve the same client shell',
      actual: canvas.status === 200 && canvasHtml.includes('id="root"') && canvasHtml.includes('<title>sky</title>'),
      expected: true,
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
