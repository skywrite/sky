import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { createMapsHost } from './google.ts'

test('Maps reuses the existing shared key until a browser key overrides it', async () => {
  const secrets = new TestSecretsProvider(),
    requests: Array<{ url: string; key: string | null }> = []
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), key: new Headers(init?.headers).get('X-Goog-Api-Key') })
    const place = {
      id: 'sample_place',
      displayName: { text: 'Garden House' },
      formattedAddress: '12 Example Street',
      types: ['cafe'],
      location: { latitude: 48.85837, longitude: 2.294481 },
      addressComponents: [{ longText: 'France', shortText: 'FR', types: ['country'] }],
    }
    return Response.json(String(url).includes('searchText') ? { places: [place] } : place)
  }) as typeof fetch
  const host = createMapsHost({ GOOGLE_MAPS_KEY: 'sample-shared-key' }, secrets, request)
  const before = await host.config()
  const configured = await host.configure({ browserKey: 'sample-browser-key', mapId: 'sample-map-id' })
  const found = await host.search('Garden House'),
    draft = await host.detail(found[0].id)
  assert({
    given: 'an existing shared Maps key followed by a separate saved browser key',
    should: 'render maps without new setup, allow an override, and keep lookups on the existing key',
    actual: [
      before.searchAvailable,
      before.browserKey,
      configured.browserKey,
      JSON.stringify(configured).includes('sample-shared-key'),
      requests.map((r) => r.key),
      draft.kind,
      draft.category,
      draft.country,
    ],
    expected: [
      true,
      'sample-shared-key',
      'sample-browser-key',
      false,
      ['sample-shared-key', 'sample-shared-key'],
      'venue',
      'drink',
      'FR',
    ],
  })
})

test('Maps keeps explicitly server-only keys private and honors browser key precedence', async () => {
  const secrets = new TestSecretsProvider({
    'google-maps/server': createSecret('sample-private-server-key'),
  })
  const serverOnly = await createMapsHost({}, secrets).config()
  const envOverride = await createMapsHost(
    { GOOGLE_MAPS_KEY: 'sample-shared-key', GOOGLE_MAPS_BROWSER_KEY: 'sample-env-browser-key' },
    secrets,
  ).config()
  await secrets.set('google-maps', 'browser', createSecret('sample-stored-browser-key'))
  const storedOverride = await createMapsHost(
    { GOOGLE_MAPS_KEY: 'sample-shared-key', GOOGLE_MAPS_BROWSER_KEY: 'sample-env-browser-key' },
    secrets,
  ).config()
  const unavailableSecrets = new TestSecretsProvider()
  unavailableSecrets.list = async () => {
    throw new Error('Keychain unavailable')
  }
  const fallback = await createMapsHost({ GOOGLE_MAPS_KEY: 'sample-shared-key' }, unavailableSecrets).config()
  assert({
    given: 'a private search key, browser overrides, and an unavailable keychain',
    should: 'keep the private key out of every map config and retain the shared environment fallback',
    actual: [
      serverOnly.searchAvailable,
      serverOnly.browserKey,
      envOverride.browserKey,
      storedOverride.browserKey,
      fallback.browserKey,
      JSON.stringify([serverOnly, envOverride, storedOverride, fallback]).includes('sample-private-server-key'),
    ],
    expected: [true, '', 'sample-env-browser-key', 'sample-stored-browser-key', 'sample-shared-key', false],
  })
})

test('Google lookup supports existing Places projects and does not reflect credential-bearing provider errors', async () => {
  let legacy = false
  const request = (async (url: string | URL | Request) => {
    if (String(url).startsWith('https://places.googleapis.com/')) return Response.json({}, { status: 403 })
    legacy = true
    return Response.json({
      status: 'OK',
      results: [
        {
          place_id: 'sample_city',
          name: 'Harbor City',
          types: ['locality'],
          geometry: { location: { lat: 48.85837, lng: 2.294481 } },
        },
      ],
    })
  }) as typeof fetch
  const host = createMapsHost({ GOOGLE_MAPS_KEY: 'sample-private-key' }, new TestSecretsProvider(), request)
  const result = await host.search('Harbor City')
  const broken = createMapsHost({ GOOGLE_MAPS_KEY: 'sample-private-key' }, new TestSecretsProvider(), async () => {
    throw new Error('request failed with sample-private-key')
  })
  let message = ''
  try {
    await broken.search('Cafe')
  } catch (error) {
    message = (error as Error).message
  }
  assert({
    given: 'a project with only the original Places API and an upstream network failure',
    should: 'support the existing lookup and report a safe actionable error',
    actual: [legacy, result[0].kind, message.includes('sample-private-key'), message.includes('manually')],
    expected: [true, 'city', false, true],
  })
})
