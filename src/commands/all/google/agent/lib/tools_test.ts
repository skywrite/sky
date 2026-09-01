import { GoogleClient, WORKSPACE_MIME, saveAccountTokens } from '#lib/google/mod.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { createAgentTools, createMissionState } from './tools.ts'

// ── Uploaded Office files through the agent tools ──────────────────────

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const TWIN_URL = 'https://docs.google.com/spreadsheets/d/f2/edit'
const TWIN_QUERY = "appProperties has { key='skyConvertedFrom' and value='f1' } and trashed = false"
const TWIN_COPY_BODY =
  '{"name":"Atlas Tracker v4 (Google Sheets)","mimeType":"application/vnd.google-apps.spreadsheet",' +
  '"appProperties":{"skyConvertedFrom":"f1","skySourceModified":"2026-03-02T10:00:00.000Z"}}'

interface DriveCall {
  path: string
  q: string | null
  body?: string
}

/**
 * Fake Drive/Sheets holding one uploaded xlsx (f1): its metadata, the twin
 * lookup (empty, or the twin f2 when `twinExists`), copies minting f2, f2's
 * csv export, and the Sheets API's refusal of f1 itself.
 */
function uploadedWorkbookApi(twinExists: boolean): (url: URL) => Response {
  const twin = {
    id: 'f2',
    name: 'Atlas Tracker v4 (Google Sheets)',
    mimeType: WORKSPACE_MIME.sheet,
    webViewLink: TWIN_URL,
    appProperties: { skyConvertedFrom: 'f1', skySourceModified: '2026-03-02T10:00:00.000Z' },
  }
  return (url) => {
    if (url.pathname === '/drive/v3/files') {
      return new Response(JSON.stringify({ files: twinExists ? [twin] : [] }), { status: 200 })
    }
    if (url.pathname.endsWith('/copy')) return new Response(JSON.stringify(twin), { status: 200 })
    if (url.pathname.endsWith('/f2/export')) return new Response('Line,Amount\nAtlas hosting,1200', { status: 200 })
    if (url.hostname === 'sheets.googleapis.com') {
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: 'This operation is not supported for this document. The document must not be an Office file.',
          },
        }),
        { status: 400 },
      )
    }
    return new Response(
      JSON.stringify({
        id: 'f1',
        name: 'Atlas Tracker v4.xlsx',
        mimeType: XLSX_MIME,
        modifiedTime: '2026-03-02T10:00:00.000Z',
      }),
      { status: 200 },
    )
  }
}

async function agentToolsOver(api: (url: URL) => Response, calls: DriveCall[]) {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const parsed = new URL(String(url))
    calls.push({
      path: parsed.pathname,
      q: parsed.searchParams.get('q'),
      body: init?.body === undefined ? undefined : String(init.body),
    })
    return api(parsed)
  }) as typeof fetch
  const client = new GoogleClient({
    secrets,
    email: 'jane@example.com',
    client: { clientId: 'id', clientSecret: 'sec' },
    fetchFn,
    sleep: async () => {},
  })
  const log: string[] = []
  const tools = createAgentTools({
    client,
    log: (line) => log.push(line),
    state: createMissionState(),
    critiquePrompt: '',
    deckCritiquePrompt: '',
    docCritiquePrompt: '',
  })
  return { tools, log }
}

test('read_file - an uploaded workbook is read through a freshly converted native twin', async () => {
  const calls: DriveCall[] = []
  const { tools, log } = await agentToolsOver(uploadedWorkbookApi(false), calls)

  const result = (await tools.read_file.execute({ fileId: 'f1' })) as Record<string, unknown>

  assert({
    given: 'an .xlsx uploaded to Drive with no twin yet',
    should: "return the twin's id, kind and content, naming the source and that the twin is new",
    expected: {
      id: 'f2',
      kind: 'sheet',
      sourceId: 'f1',
      twin: { id: 'f2', name: 'Atlas Tracker v4 (Google Sheets)', url: TWIN_URL, created: true },
      content: 'Line,Amount\nAtlas hosting,1200',
      notePointsAtTwin: true,
    },
    actual: {
      id: result.id,
      kind: result.kind,
      sourceId: result.sourceId,
      twin: result.twin,
      content: result.content,
      notePointsAtTwin: String(result.note).includes('Use the twin id f2'),
    },
  })

  assert({
    given: 'the requests the read made',
    should:
      'look the twin up by source stamp, convert with the Sheets mimeType and stamp, then export the twin — the original untouched',
    expected: [
      { path: '/drive/v3/files/f1', q: null, body: undefined },
      { path: '/drive/v3/files', q: TWIN_QUERY, body: undefined },
      { path: '/drive/v3/files/f1/copy', q: null, body: TWIN_COPY_BODY },
      { path: '/drive/v3/files/f2/export', q: null, body: undefined },
    ],
    actual: calls,
  })

  assert({
    given: 'the progress feed',
    should: 'announce the conversion, then the read of the twin',
    expected: [
      `Converted "Atlas Tracker v4.xlsx" to a native sheet — ${TWIN_URL}`,
      'Read "Atlas Tracker v4 (Google Sheets)" (sheet, 30 chars)',
    ],
    actual: log,
  })
})

test('read_file - a twin of the same source revision is reused, nothing converted', async () => {
  const calls: DriveCall[] = []
  const { tools, log } = await agentToolsOver(uploadedWorkbookApi(true), calls)

  const result = (await tools.read_file.execute({ fileId: 'f1' })) as Record<string, unknown>

  assert({
    given: 'an .xlsx whose twin was converted from this same revision before',
    should: 'read the existing twin without copying, and say so',
    expected: {
      twin: { id: 'f2', name: 'Atlas Tracker v4 (Google Sheets)', url: TWIN_URL, created: false },
      copies: 0,
      firstLog: `Reading "Atlas Tracker v4.xlsx" through its native sheet twin — ${TWIN_URL}`,
    },
    actual: { twin: result.twin, copies: calls.filter((c) => c.path.endsWith('/copy')).length, firstLog: log[0] },
  })
})

test("copy_file - convert stamps the copy as the source's twin", async () => {
  const calls: DriveCall[] = []
  const { tools, log } = await agentToolsOver(uploadedWorkbookApi(false), calls)

  const plain = (await tools.copy_file.execute({ fileId: 'f1', title: 'Atlas Tracker copy' })) as Record<
    string,
    unknown
  >
  const converted = (await tools.copy_file.execute({
    fileId: 'f1',
    title: 'Atlas Tracker v4 (Google Sheets)',
    convert: true,
  })) as Record<string, unknown>

  assert({
    given: 'a plain copy and a converting copy of an uploaded xlsx',
    should: 'send name only for the plain one, and the Sheets mimeType plus source stamp for the conversion',
    expected: ['{"name":"Atlas Tracker copy"}', TWIN_COPY_BODY],
    actual: calls.filter((c) => c.path.endsWith('/copy')).map((c) => c.body),
  })

  assert({
    given: 'the results and progress lines',
    should: 'report the copy kind from Drive and say Converted for the conversion',
    expected: {
      kinds: ['sheet', 'sheet'],
      log: [
        `Copied to "Atlas Tracker v4 (Google Sheets)" — ${TWIN_URL}`,
        `Converted to "Atlas Tracker v4 (Google Sheets)" — ${TWIN_URL}`,
      ],
    },
    actual: { kinds: [plain.kind, converted.kind], log },
  })
})

test('get_values - the Sheets API refusal of an Office file points at read_file', async () => {
  const { tools } = await agentToolsOver(uploadedWorkbookApi(false), [])

  const result = String(await tools.get_values.execute({ spreadsheetId: 'f1', range: 'Budget!A1:B2' }))

  assert({
    given: 'get_values on the uploaded original instead of its twin',
    should: 'surface the API error with the read_file / twin hint appended',
    expected: [true, true, true],
    actual: [
      result.startsWith('Error: Google API 400'),
      result.includes('must not be an Office file'),
      result.includes('read_file converts it to a native Google twin'),
    ],
  })
})
