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

// ── restyle_doc: fonts and sizes by role, proved by read-back ───────────

const HANDBOOK_URL = 'https://docs.google.com/document/d/d1/edit'

function handbookTab(tabId: string, title: string, family: string, sizes: { heading: number; body: number }) {
  return {
    tabProperties: { tabId, title },
    documentTab: {
      namedStyles: {
        styles: [
          {
            namedStyleType: 'NORMAL_TEXT',
            textStyle: { weightedFontFamily: { fontFamily: family }, fontSize: { magnitude: sizes.body } },
          },
          { namedStyleType: 'HEADING_1', textStyle: { fontSize: { magnitude: sizes.heading } } },
        ],
      },
      body: {
        content: [
          { endIndex: 1 },
          {
            startIndex: 1,
            endIndex: 9,
            paragraph: {
              paragraphStyle: { namedStyleType: 'HEADING_1' },
              elements: [{ startIndex: 1, endIndex: 9, textRun: { content: 'Welcome\n' } }],
            },
          },
          {
            startIndex: 9,
            endIndex: 20,
            paragraph: {
              paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
              elements: [{ startIndex: 9, endIndex: 20, textRun: { content: 'Hello team\n' } }],
            },
          },
        ],
      },
    },
  }
}

/** Fake Drive + Docs: the handbook reads as Arial first and as Inter once a batch has been applied. */
function handbookApi(): (url: URL) => Response {
  let updated = false
  return (url) => {
    if (url.pathname === '/drive/v3/files/d1') {
      return new Response(
        JSON.stringify({ id: 'd1', name: 'Atlas Handbook', mimeType: WORKSPACE_MIME.doc, webViewLink: HANDBOOK_URL }),
        { status: 200 },
      )
    }
    if (url.pathname.endsWith(':batchUpdate')) {
      updated = true
      return new Response(JSON.stringify({ replies: [{}, {}, {}, {}, {}, {}] }), { status: 200 })
    }
    if (url.pathname === '/v1/documents/d1') {
      const style = updated ? { family: 'Inter', heading: 14, body: 10 } : { family: 'Arial', heading: 20, body: 11 }
      return new Response(
        JSON.stringify({
          title: 'Atlas Handbook',
          tabs: [handbookTab('t.0', 'Overview', style.family, style), handbookTab('t.1', 'Notes', style.family, style)],
        }),
        { status: 200 },
      )
    }
    return new Response('{}', { status: 404 })
  }
}

test('restyle_doc - one call styles every tab by role and proves it by reading back', async () => {
  const calls: DriveCall[] = []
  const { tools, log } = await agentToolsOver(handbookApi(), calls)

  const result = (await tools.restyle_doc.execute({
    fileId: 'd1',
    fontFamily: 'Inter',
    sizes: { heading1: 14, body: 10 },
  })) as Record<string, unknown>

  const batch = calls.find((c) => c.path.endsWith(':batchUpdate'))
  const requests = (
    JSON.parse(batch?.body ?? '{}') as { requests: Array<{ updateTextStyle: Record<string, unknown> }> }
  ).requests

  assert({
    given: 'a two-tab doc, a family and sizes for heading1 and body',
    should: 'read the doc, send one batch of six tab-scoped updateTextStyle requests, then read it back',
    expected: {
      paths: ['/drive/v3/files/d1', '/v1/documents/d1', '/v1/documents/d1:batchUpdate', '/v1/documents/d1'],
      kinds: [
        'updateTextStyle',
        'updateTextStyle',
        'updateTextStyle',
        'updateTextStyle',
        'updateTextStyle',
        'updateTextStyle',
      ],
      firstRange: { startIndex: 1, endIndex: 19, tabId: 't.0' },
      firstFields: 'weightedFontFamily',
      tabs: ['t.0', 't.0', 't.0', 't.1', 't.1', 't.1'],
    },
    actual: {
      paths: calls.map((c) => c.path),
      kinds: requests.map((r) => Object.keys(r)[0]),
      firstRange: requests[0]?.updateTextStyle.range,
      firstFields: requests[0]?.updateTextStyle.fields,
      tabs: requests.map((r) => (r.updateTextStyle.range as { tabId: string }).tabId),
    },
  })

  assert({
    given: 'the result and the progress feed',
    should: 'report the tabs, the applied count and a clean read-back, and log one line per batch plus the summary',
    expected: {
      file: 'Atlas Handbook',
      restyled: 'Inter; heading1 14pt, body 10pt',
      tabs: [
        { tabId: 't.0', title: 'Overview', paragraphs: 2 },
        { tabId: 't.1', title: 'Notes', paragraphs: 2 },
      ],
      applied: 6,
      readBack: { runs: 4, matching: 4, off: [], skipped: 0 },
      log: [
        'Restyling "Atlas Handbook": batch 1/1 (6 requests)',
        'Restyled "Atlas Handbook" — Inter; heading1 14pt, body 10pt: 2 tab(s), 6 request(s); read-back: all 4 text runs match',
      ],
    },
    actual: {
      file: result.file,
      restyled: result.restyled,
      tabs: result.tabs,
      applied: result.applied,
      readBack: result.readBack,
      log,
    },
  })
})

test('restyle_doc - a bad spec is refused before anything is read or written', async () => {
  const calls: DriveCall[] = []
  const { tools } = await agentToolsOver(handbookApi(), calls)

  const result = String(await tools.restyle_doc.execute({ fileId: 'd1', sizes: { caption: 9 } } as never))

  assert({
    given: 'a size for a role that does not exist',
    should: 'name the role and the valid roles, with no API call made',
    expected: { error: true, namesRole: true, calls: 0 },
    actual: {
      error: result.startsWith('Error: unknown role "caption"'),
      namesRole: result.includes('tableHeader'),
      calls: calls.length,
    },
  })
})

// ── The repetition guard around every mission tool ──────────────────────

test('a mission tool called three times with the same input and result is refused the third time', async () => {
  const calls: DriveCall[] = []
  const { tools, log } = await agentToolsOver(uploadedWorkbookApi(false), calls)

  const first = await tools.find_files.execute({ query: 'Atlas' })
  const second = (await tools.find_files.execute({ query: 'Atlas' })) as unknown as Record<string, unknown>
  const third = String(await tools.find_files.execute({ query: 'Atlas' }))

  assert({
    given: 'three identical Drive searches that all come back empty',
    should:
      'run two — the second carrying the repeat note — refuse the third without a request, and say so in the feed',
    expected: {
      first: [],
      secondNoted: true,
      thirdRefused: true,
      driveSearches: 2,
      lastLog: 'Refused a repeated find_files call — same input, same result twice already',
    },
    actual: {
      first,
      secondNoted: String(second.repeated).includes('nothing has changed since'),
      thirdRefused: third.startsWith('Error: refused — this exact find_files call'),
      driveSearches: calls.filter((c) => c.path === '/drive/v3/files').length,
      lastLog: log.at(-1),
    },
  })
})
