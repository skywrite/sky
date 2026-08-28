import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { GoogleClient } from './client.ts'
import { ensureConvertedTwin, findConvertedTwin, twinName } from './convertedTwin.ts'
import { WORKSPACE_MIME } from './drive.ts'
import type { DriveFile } from './drive.ts'
import { saveAccountTokens } from './tokens.ts'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const source: DriveFile = {
  id: 'src1',
  name: 'Atlas Tracker v4.xlsx',
  mimeType: XLSX_MIME,
  modifiedTime: '2026-03-02T10:00:00.000Z',
}

const twin: DriveFile = {
  id: 'twin1',
  name: 'Atlas Tracker v4 (Google Sheets)',
  mimeType: WORKSPACE_MIME.sheet,
  webViewLink: 'https://docs.google.com/spreadsheets/d/twin1/edit',
  appProperties: { skyConvertedFrom: 'src1', skySourceModified: '2026-03-02T10:00:00.000Z' },
}

interface Call {
  path: string
  q: string | null
  body?: string
}

/** A fake Drive whose files.list answers with `listed` and whose files.copy mints twin2. */
async function driveWith(listed: DriveFile[], calls: Call[]): Promise<GoogleClient> {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const parsed = new URL(String(url))
    calls.push({
      path: parsed.pathname,
      q: parsed.searchParams.get('q'),
      body: init?.body ? String(init.body) : undefined,
    })
    if (parsed.pathname.endsWith('/copy')) {
      return new Response(JSON.stringify({ ...twin, id: 'twin2' }), { status: 200 })
    }
    return new Response(JSON.stringify({ files: listed }), { status: 200 })
  }) as typeof fetch
  return new GoogleClient({
    secrets,
    email: 'jane@example.com',
    client: { clientId: 'id', clientSecret: 'sec' },
    fetchFn,
    sleep: async () => {},
  })
}

test('twinName', () => {
  assert({
    given: 'uploaded file names and their conversion kinds',
    should: 'drop the extension and append the Google product, like a Save-as copy',
    expected: [
      'Atlas Tracker v4 (Google Sheets)',
      'Atlas MSA (Google Docs)',
      'Atlas pitch (Google Slides)',
      'Atlas (Google Sheets)',
    ],
    actual: [
      twinName('Atlas Tracker v4.xlsx', 'sheet'),
      twinName('Atlas MSA.docx', 'doc'),
      twinName('Atlas pitch.pptx', 'slides'),
      twinName('Atlas', 'sheet'),
    ],
  })
})

test('findConvertedTwin - looks the twin up by its source stamp', async () => {
  const calls: Call[] = []
  const client = await driveWith([twin], calls)

  const found = await findConvertedTwin(client, 'src1')

  assert({
    given: 'a source id',
    should: 'query files.list on the appProperties stamp, newest first, and return the match',
    expected: {
      q: "appProperties has { key='skyConvertedFrom' and value='src1' } and trashed = false",
      id: 'twin1',
    },
    actual: { q: calls[0].q, id: found?.id },
  })
})

test('ensureConvertedTwin - converts when no twin exists', async () => {
  const calls: Call[] = []
  const client = await driveWith([], calls)

  const result = await ensureConvertedTwin(client, source)

  assert({
    given: 'an uploaded xlsx with no twin yet',
    should: 'copy it with the Sheets mimeType and the source stamp, under the Save-as name',
    expected: {
      created: true,
      kind: 'sheet',
      id: 'twin2',
      copyBody:
        '{"name":"Atlas Tracker v4 (Google Sheets)","mimeType":"application/vnd.google-apps.spreadsheet",' +
        '"appProperties":{"skyConvertedFrom":"src1","skySourceModified":"2026-03-02T10:00:00.000Z"}}',
    },
    actual: {
      created: result.created,
      kind: result.kind,
      id: result.twin.id,
      copyBody: calls.find((c) => c.path.endsWith('/copy'))?.body,
    },
  })
})

test('ensureConvertedTwin - reuses a twin of the same source revision', async () => {
  const calls: Call[] = []
  const client = await driveWith([twin], calls)

  const result = await ensureConvertedTwin(client, source)

  assert({
    given: "a twin stamped with the source's current modifiedTime",
    should: 'return it without copying anything',
    expected: { created: false, id: 'twin1', copies: 0 },
    actual: {
      created: result.created,
      id: result.twin.id,
      copies: calls.filter((c) => c.path.endsWith('/copy')).length,
    },
  })
})

test('ensureConvertedTwin - converts again when the source changed since the twin was made', async () => {
  const calls: Call[] = []
  const client = await driveWith([twin], calls)

  const result = await ensureConvertedTwin(client, { ...source, modifiedTime: '2026-03-09T08:00:00.000Z' })

  assert({
    given: "a twin whose stamp predates the source's latest change",
    should: 'convert a fresh twin and hand back the stale one as superseded, untouched',
    expected: { created: true, id: 'twin2', superseded: 'twin1', copies: 1 },
    actual: {
      created: result.created,
      id: result.twin.id,
      superseded: result.superseded?.id,
      copies: calls.filter((c) => c.path.endsWith('/copy')).length,
    },
  })
})

test('ensureConvertedTwin - refuses what Drive cannot convert', async () => {
  const calls: Call[] = []
  const client = await driveWith([], calls)

  let message = ''
  try {
    await ensureConvertedTwin(client, { id: 'img', name: 'logo.png', mimeType: 'image/png' })
  } catch (err) {
    message = (err as Error).message
  }

  assert({
    given: 'an image',
    should: 'throw before any request',
    expected: ['Drive has no Google conversion for "logo.png" (image/png)', 0],
    actual: [message, calls.length],
  })
})
