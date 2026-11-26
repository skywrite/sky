import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { assert, test } from '#test'
import { createTestHttpApp } from '../service/handler/httpTestHelpers.ts'

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
      should: 'mount the client app, load its assets, and identify Today while loading',
      actual:
        html.includes('id="root"') &&
        html.includes('/_assets/main.js') &&
        html.includes('/_assets/main.css') &&
        html.includes('<title>sky · Today</title>'),
      expected: true,
    })

    const dated = await app.request('http://localhost/2025-04-07?view=record')
    assert({
      given: 'a direct request for a dated day',
      should: 'identify the requested day before the client loads',
      actual: (await dated.text()).includes('<title>sky · 2025-04-07</title>'),
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

test({ name: 'app icon - the shell names it and both images are served' }, async () => {
  await withApp(async (app) => {
    const html = await (await app.request('http://localhost/')).text()

    assert({
      given: 'the app shell',
      should: "name the tab's icon, the home screen's icon, and the name shown under it",
      actual:
        html.includes('<link rel="icon" type="image/png" href="/favicon.png" />') &&
        html.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />') &&
        html.includes('<meta name="apple-mobile-web-app-title" content="Sky" />'),
      expected: true,
    })

    // A PNG opens with its signature; the header after it carries width, height, and color type
    // (2 has no transparency, 6 has). A home-screen icon with clear pixels is filled in with black.
    const icons = [
      { name: 'favicon.png', size: 96, colorType: 6 },
      { name: 'apple-touch-icon.png', size: 180, colorType: 2 },
    ]
    for (const icon of icons) {
      const response = await app.request(`http://localhost/${icon.name}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const header = new DataView(bytes.buffer)

      assert({
        given: `a request for /${icon.name}`,
        should: 'serve the square PNG the shell points to',
        actual: {
          status: response.status,
          type: response.headers.get('content-type'),
          png: String.fromCharCode(...bytes.slice(1, 4)),
          width: header.getUint32(16),
          height: header.getUint32(20),
          colorType: bytes[25],
        },
        expected: {
          status: 200,
          type: 'image/png',
          png: 'PNG',
          width: icon.size,
          height: icon.size,
          colorType: icon.colorType,
        },
      })
    }
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

test({ name: 'voice visuals do not serve retired avatar or lip-analysis assets' }, async () => {
  await withApp(async (app) => {
    for (const name of [
      'voice-sky.glb',
      'voice-sonny.glb',
      'voice-headaudio-worklet.mjs',
      'voice-headaudio-model.bin',
    ]) {
      const response = await app.request(`http://localhost/_assets/${name}`)
      assert({
        given: 'a retired human-avatar or lip-analysis asset request',
        should: 'return missing because cloud visuals are procedural',
        actual: response.status,
        expected: 404,
      })
    }
  })
})

test({ name: 'theme assets - a browser that accepts compression gets the same bundle, smaller' }, async () => {
  await withApp(async (app) => {
    const plain = await app.request('http://localhost/_assets/main.js')
    const raw = new Uint8Array(await plain.arrayBuffer())
    const ask = async (accepts: string) => {
      const response = await app.request('http://localhost/_assets/main.js', {
        headers: { 'Accept-Encoding': accepts },
      })
      return {
        encoding: response.headers.get('content-encoding'),
        bytes: new Uint8Array(await response.arrayBuffer()),
      }
    }
    const brotli = await ask('gzip, deflate, br, zstd')
    const gzip = await ask('gzip, deflate')
    const neither = await ask('br;q=0, gzip;q=0')

    assert({
      given: 'a request that names no compression',
      should: 'serve the bundle as it is, and say the answer depends on what the browser accepts',
      actual: { encoding: plain.headers.get('content-encoding'), vary: plain.headers.get('vary') },
      expected: { encoding: null, vary: 'Accept-Encoding' },
    })

    assert({
      given: 'browsers that accept Brotli, only gzip, or neither',
      should: 'answer each in the smallest form it accepts',
      actual: [brotli.encoding, gzip.encoding, neither.encoding],
      expected: ['br', 'gzip', null],
    })

    assert({
      given: 'the compressed answers',
      should: 'unpack to exactly the bundle served plain',
      actual: [
        Buffer.compare(brotliDecompressSync(brotli.bytes), raw),
        Buffer.compare(gunzipSync(gzip.bytes), raw),
        Buffer.compare(neither.bytes, raw),
      ],
      expected: [0, 0, 0],
    })

    assert({
      given: 'the sizes sent',
      should: 'send well under half of the bundle to a browser that accepts Brotli or gzip',
      actual: [brotli.bytes.length < raw.length * 0.4, gzip.bytes.length < raw.length * 0.4],
      expected: [true, true],
    })
  })
})

test('app install - the shell links a manifest that installs Sky as its own app, with icons that are served', async () => {
  await withApp(async (app) => {
    const html = await (await app.request('http://localhost/')).text()
    const response = await app.request('http://localhost/manifest.webmanifest')
    const manifest = (await response.json()) as {
      name: string
      start_url: string
      display: string
      icons: Array<{ src: string; sizes: string; type: string }>
    }

    assert({
      given: 'the app shell and the manifest it links',
      should: 'name Sky, open the app at / in a window of its own, and say what kind of file it is',
      actual: {
        linked: html.includes('<link rel="manifest" href="/manifest.webmanifest" />'),
        type: response.headers.get('content-type'),
        name: manifest.name,
        start: manifest.start_url,
        display: manifest.display,
      },
      expected: { linked: true, type: 'application/manifest+json', name: 'Sky', start: '/', display: 'standalone' },
    })

    const icons = await Promise.all(
      manifest.icons.map(async (icon) => {
        const served = await app.request(`http://localhost${icon.src}`)
        const header = new DataView(await served.arrayBuffer())
        return `${served.status} ${served.headers.get('content-type')} ${header.getUint32(16)}x${header.getUint32(20)}`
      }),
    )
    assert({
      given: 'each icon the manifest lists',
      should: 'be served as a PNG of the size the manifest states, including the two sizes installs need',
      actual: icons,
      expected: manifest.icons.map((icon) => `200 image/png ${icon.sizes}`),
    })
    assert({
      given: 'the manifest’s icon sizes',
      should: 'include 192 and 512 pixels',
      actual: manifest.icons.map((icon) => icon.sizes),
      expected: ['192x192', '512x512'],
    })
  })
})
