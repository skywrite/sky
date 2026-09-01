import { GoogleClient, WORKSPACE_MIME, saveAccountTokens } from '#lib/google/mod.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { READ_LIMIT_CHARS, paginateRead, readWorkspaceFile } from './readWorkspaceFile.ts'

test('paginateRead - returns short files whole', () => {
  const page = paginateRead('a short contract')

  assert({
    given: 'content under the read limit',
    should: 'return it complete, unmarked',
    expected: { content: 'a short contract', start: 0, end: 16, complete: true },
    actual: page,
  })
})

test('paginateRead - pages through a long file with self-directing markers', () => {
  const full = 'x'.repeat(READ_LIMIT_CHARS * 2 + 100)

  const first = paginateRead(full)
  const second = paginateRead(full, READ_LIMIT_CHARS)
  const last = paginateRead(full, READ_LIMIT_CHARS * 2)

  assert({
    given: 'a file two and a half pages long, read from the top',
    should: 'return one page plus a marker naming the total and the next offset',
    expected: {
      complete: false,
      end: READ_LIMIT_CHARS,
      marker: `\n\n[Truncated — ${full.length} chars total; continue with offset: ${READ_LIMIT_CHARS}]`,
    },
    actual: {
      complete: first?.complete,
      end: first?.end,
      marker: first?.content.slice(READ_LIMIT_CHARS),
    },
  })

  assert({
    given: 'the offset the first marker named',
    should: 'continue with the next full page and point at the tail',
    expected: { start: READ_LIMIT_CHARS, end: READ_LIMIT_CHARS * 2, complete: false },
    actual: { start: second?.start, end: second?.end, complete: second?.complete },
  })

  assert({
    given: 'the offset reaching the final partial page',
    should: 'return the tail complete, without a marker',
    expected: { content: 'x'.repeat(100), complete: true },
    actual: { content: last?.content, complete: last?.complete },
  })
})

test('paginateRead - clamps bad offsets and rejects past-the-end ones', () => {
  assert({
    given: 'a negative, fractional offset',
    should: 'clamp to the start of the file',
    expected: { start: 0, content: 'abc' },
    actual: (({ start, content }) => ({ start, content }))(paginateRead('abc', -7.5)!),
  })

  assert({
    given: 'an offset at or past the end of a non-empty file',
    should: 'return null so the tool can error',
    expected: [null, null],
    actual: [paginateRead('abc', 3), paginateRead('abc', 99)],
  })

  assert({
    given: 'an empty file read from the top',
    should: 'return an empty complete page, not an error',
    expected: { content: '', complete: true },
    actual: (({ content, complete }) => ({ content, complete }))(paginateRead('')!),
  })
})

// ── readWorkspaceFile over a faked Drive/Docs API ──────────────────────

async function clientOver(api: (url: URL) => Response): Promise<GoogleClient> {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })
  const fetchFn = (async (url: unknown) => api(new URL(String(url)))) as typeof fetch
  return new GoogleClient({
    secrets,
    email: 'jane@example.com',
    client: { clientId: 'id', clientSecret: 'sec' },
    fetchFn,
    sleep: async () => {},
  })
}

const DOC_META = JSON.stringify({
  id: 'd1',
  name: 'Atlas Plan',
  mimeType: WORKSPACE_MIME.doc,
  webViewLink: 'https://docs.google.com/document/d/d1/edit',
})

const SHEET_META = JSON.stringify({
  id: 's1',
  name: 'Atlas Budget',
  mimeType: WORKSPACE_MIME.sheet,
  webViewLink: 'https://docs.google.com/spreadsheets/d/s1/edit',
})

test('readWorkspaceFile - a multi-tab doc exports whole with its tab map', async () => {
  const client = await clientOver((url) => {
    if (url.pathname.endsWith('/d1/export')) return new Response('# Overview\nplan\n# Numbers\ndata', { status: 200 })
    if (url.hostname === 'docs.googleapis.com') {
      return new Response(
        JSON.stringify({
          tabs: [
            { tabProperties: { tabId: 't.0', title: 'Overview' } },
            { tabProperties: { tabId: 't.1', title: 'Numbers' } },
          ],
        }),
        { status: 200 },
      )
    }
    return new Response(DOC_META, { status: 200 })
  })

  const outcome = await readWorkspaceFile(client, { fileId: 'd1' })

  assert({
    given: 'a two-tab Google Doc read whole',
    should: 'return the full markdown export plus the tab map',
    expected: {
      ok: true,
      kind: 'doc',
      content: '# Overview\nplan\n# Numbers\ndata',
      tabs: [
        { tabId: 't.0', title: 'Overview' },
        { tabId: 't.1', title: 'Numbers' },
      ],
    },
    actual: outcome.ok
      ? {
          ok: true,
          kind: outcome.read.kind,
          content: outcome.read.content,
          tabs: outcome.read.tabs?.map((t) => ({ tabId: t.tabId, title: t.title })),
        }
      : outcome,
  })
})

test('readWorkspaceFile - reads one doc tab as plain text and names unknown tabs', async () => {
  const client = await clientOver((url) => {
    if (url.hostname === 'docs.googleapis.com') {
      return new Response(
        JSON.stringify({
          tabs: [
            {
              tabProperties: { tabId: 't.0', title: 'Overview' },
              documentTab: {
                body: { content: [{ paragraph: { elements: [{ textRun: { content: 'plan text\n' } }] } }] },
              },
            },
          ],
        }),
        { status: 200 },
      )
    }
    return new Response(DOC_META, { status: 200 })
  })

  const read = await readWorkspaceFile(client, { fileId: 'd1', tabId: 't.0' })
  const miss = await readWorkspaceFile(client, { fileId: 'd1', tabId: 't.9' })

  assert({
    given: 'a tab-targeted read',
    should: 'return that tab base text and identify the tab',
    expected: { ok: true, content: 'plan text\n', tab: { tabId: 't.0', title: 'Overview' } },
    actual: read.ok ? { ok: true, content: read.read.content, tab: read.read.tab } : read,
  })

  assert({
    given: 'a tabId the doc does not have',
    should: 'miss with a message naming the tabs that exist',
    expected: { ok: false, message: 'No tab t.9 in "Atlas Plan" — its tabs: t.0 ("Overview")' },
    actual: miss,
  })
})

test('readWorkspaceFile - a sheet exports as csv without any docs-api call', async () => {
  const client = await clientOver((url) => {
    if (url.hostname === 'docs.googleapis.com') throw new Error('sheets must not hit the docs api')
    if (url.pathname.endsWith('/s1/export')) return new Response('Line,Amount\nAtlas hosting,1200', { status: 200 })
    return new Response(SHEET_META, { status: 200 })
  })

  const outcome = await readWorkspaceFile(client, { fileId: 's1' })

  assert({
    given: 'a Google Sheet read whole',
    should: 'return its csv with no tab map',
    expected: { ok: true, kind: 'sheet', content: 'Line,Amount\nAtlas hosting,1200', tabs: undefined },
    actual: outcome.ok
      ? { ok: true, kind: outcome.read.kind, content: outcome.read.content, tabs: outcome.read.tabs }
      : outcome,
  })
})

test('readWorkspaceFile - truncates long exports and rejects past-the-end offsets', async () => {
  const full = 'x'.repeat(READ_LIMIT_CHARS + 100)
  const client = await clientOver((url) => {
    if (url.pathname.endsWith('/s1/export')) return new Response(full, { status: 200 })
    return new Response(SHEET_META, { status: 200 })
  })

  const first = await readWorkspaceFile(client, { fileId: 's1' })
  const past = await readWorkspaceFile(client, { fileId: 's1', offset: full.length })

  assert({
    given: 'an export one page and a bit long',
    should: 'end the first page with the continuation marker',
    expected: {
      ok: true,
      marker: `\n\n[Truncated — ${full.length} chars total; continue with offset: ${READ_LIMIT_CHARS}]`,
    },
    actual: first.ok ? { ok: true, marker: first.read.content.slice(READ_LIMIT_CHARS) } : first,
  })

  assert({
    given: 'an offset past the end of the export',
    should: 'miss with the file length so the caller can restate it',
    expected: { ok: false, message: `Offset ${full.length} is past the end — "Atlas Budget" is ${full.length} chars` },
    actual: past,
  })
})

test('readWorkspaceFile - refuses files that are neither native nor convertible', async () => {
  const client = await clientOver(
    () => new Response(JSON.stringify({ id: 'p1', name: 'team.png', mimeType: 'image/png' }), { status: 200 }),
  )

  const outcome = await readWorkspaceFile(client, { fileId: 'p1' })

  assert({
    given: 'a Drive file with no readable form',
    should: 'miss with the mime type spelled out',
    expected: {
      ok: false,
      message: '"team.png" is not a Doc/Sheet/Slides file or an upload Drive can convert (image/png)',
    },
    actual: outcome,
  })
})

test('readWorkspaceFile - an uploaded workbook reads through its existing native twin', async () => {
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const twin = {
    id: 'f2',
    name: 'Atlas Tracker v4 (Google Sheets)',
    mimeType: WORKSPACE_MIME.sheet,
    webViewLink: 'https://docs.google.com/spreadsheets/d/f2/edit',
    appProperties: { skyConvertedFrom: 'f1', skySourceModified: '2026-03-02T10:00:00.000Z' },
  }
  const client = await clientOver((url) => {
    if (url.pathname === '/drive/v3/files') return new Response(JSON.stringify({ files: [twin] }), { status: 200 })
    if (url.pathname.endsWith('/f2/export')) return new Response('Line,Amount\nAtlas hosting,1200', { status: 200 })
    if (url.pathname.endsWith('/files/f2')) return new Response(JSON.stringify(twin), { status: 200 })
    return new Response(
      JSON.stringify({
        id: 'f1',
        name: 'Atlas Tracker v4.xlsx',
        mimeType: XLSX_MIME,
        modifiedTime: '2026-03-02T10:00:00.000Z',
      }),
      { status: 200 },
    )
  })

  const outcome = await readWorkspaceFile(client, { fileId: 'f1' })

  assert({
    given: 'an uploaded xlsx whose twin already exists',
    should: 'return the twin as the readable file and keep the source alongside',
    expected: { ok: true, id: 'f2', kind: 'sheet', convertedFrom: 'f1', twinCreated: false },
    actual: outcome.ok
      ? {
          ok: true,
          id: outcome.read.file.id,
          kind: outcome.read.kind,
          convertedFrom: outcome.read.convertedFrom?.id,
          twinCreated: outcome.read.twinCreated,
        }
      : outcome,
  })
})
