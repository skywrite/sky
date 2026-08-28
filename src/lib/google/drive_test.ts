import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { GoogleClient } from './client.ts'
import {
  EXPORT_MIME,
  WORKSPACE_MIME,
  buildBinaryMultipartBody,
  buildFilesQuery,
  buildMultipartBody,
  conversionTarget,
  copyFile,
  createDocFromMarkdown,
  deleteFile,
  escapeDriveQueryValue,
  exportFile,
  getFile,
  importFileAsDoc,
  renameFile,
  replaceFileWithMarkdown,
  searchFiles,
  shareFile,
  uploadFile,
  uploadedSpreadsheetFormat,
  workspaceKind,
} from './drive.ts'
import { saveAccountTokens } from './tokens.ts'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

test('buildFilesQuery', () => {
  assert({
    given: 'no options',
    should: 'match untrashed files of all three workspace kinds, uploaded workbooks among the sheets',
    expected:
      "trashed = false and (mimeType = 'application/vnd.google-apps.document'" +
      " or mimeType = 'application/vnd.google-apps.spreadsheet'" +
      ` or mimeType = '${XLSX_MIME}'` +
      " or mimeType = 'application/vnd.ms-excel.sheet.macroenabled.12'" +
      " or mimeType = 'application/vnd.ms-excel'" +
      " or mimeType = 'application/vnd.oasis.opendocument.spreadsheet'" +
      " or mimeType = 'text/csv'" +
      " or mimeType = 'application/vnd.google-apps.presentation')",
    actual: buildFilesQuery(),
  })

  assert({
    given: 'a doc kind filter',
    should: 'match only that mime type',
    expected: "trashed = false and mimeType = 'application/vnd.google-apps.document'",
    actual: buildFilesQuery({ kind: 'doc' }),
  })

  assert({
    given: 'the sheet kind filter',
    should: 'cover native Sheets and every uploaded spreadsheet format',
    expected:
      "trashed = false and (mimeType = 'application/vnd.google-apps.spreadsheet'" +
      ` or mimeType = '${XLSX_MIME}'` +
      " or mimeType = 'application/vnd.ms-excel.sheet.macroenabled.12'" +
      " or mimeType = 'application/vnd.ms-excel'" +
      " or mimeType = 'application/vnd.oasis.opendocument.spreadsheet'" +
      " or mimeType = 'text/csv')",
    actual: buildFilesQuery({ kind: 'sheet' }),
  })

  assert({
    given: 'search text',
    should: 'search both name and full text',
    expected: true,
    actual: buildFilesQuery({ text: 'atlas plan' }).endsWith(
      "(name contains 'atlas plan' or fullText contains 'atlas plan')",
    ),
  })
})

test('escapeDriveQueryValue', () => {
  assert({
    given: 'a value with quotes and backslashes',
    should: 'escape backslash first, then single quotes',
    expected: "Jane\\'s \\\\ plan",
    actual: escapeDriveQueryValue("Jane's \\ plan"),
  })

  assert({
    given: 'a query built from a quoted value',
    should: 'embed the escaped literal',
    expected: true,
    actual: buildFilesQuery({ text: "Jane's plan" }).includes("name contains 'Jane\\'s plan'"),
  })
})

test('buildMultipartBody', () => {
  const body = buildMultipartBody(
    { name: 'Atlas Plan', mimeType: 'application/vnd.google-apps.document' },
    '# Hi\n',
    'text/markdown',
    'BOUNDARY',
  )

  assert({
    given: 'metadata and markdown content',
    should: 'build an RFC 2387 multipart/related body with CRLF separators',
    expected: [
      '--BOUNDARY',
      'Content-Type: application/json; charset=UTF-8',
      '',
      '{"name":"Atlas Plan","mimeType":"application/vnd.google-apps.document"}',
      '--BOUNDARY',
      'Content-Type: text/markdown',
      '',
      '# Hi\n',
      '--BOUNDARY--',
      '',
    ].join('\r\n'),
    actual: body,
  })
})

test('buildBinaryMultipartBody', () => {
  const metadata = { name: 'logo.png', mimeType: 'image/png' }

  assert({
    given: 'ASCII content passed through both multipart builders',
    should: 'frame binary bodies byte-identically to the string builder',
    expected: buildMultipartBody(metadata, 'HI', 'image/png', 'BOUNDARY'),
    actual: new TextDecoder().decode(
      buildBinaryMultipartBody(metadata, new TextEncoder().encode('HI'), 'image/png', 'BOUNDARY'),
    ),
  })
})

test('workspace mime maps', () => {
  assert({
    given: 'a workspace mime type',
    should: 'map back to its kind',
    expected: ['doc', 'sheet', 'slides', undefined],
    actual: [
      workspaceKind(WORKSPACE_MIME.doc),
      workspaceKind(WORKSPACE_MIME.sheet),
      workspaceKind(WORKSPACE_MIME.slides),
      workspaceKind('application/pdf'),
    ],
  })

  assert({
    given: 'the export map',
    should: 'export docs as markdown, sheets as csv, slides as text',
    expected: ['text/markdown', 'text/csv', 'text/plain'],
    actual: [EXPORT_MIME.doc, EXPORT_MIME.sheet, EXPORT_MIME.slides],
  })

  assert({
    given: 'uploaded spreadsheet mime types',
    should: 'map to their short format label, native and foreign types to nothing',
    expected: ['xlsx', 'csv', undefined, undefined],
    actual: [
      uploadedSpreadsheetFormat(XLSX_MIME),
      uploadedSpreadsheetFormat('text/csv'),
      uploadedSpreadsheetFormat(WORKSPACE_MIME.sheet),
      uploadedSpreadsheetFormat('application/pdf'),
    ],
  })

  assert({
    given: 'mime types Drive can and cannot convert',
    should: 'name the workspace kind a conversion produces, undefined for native files and images',
    expected: ['sheet', 'sheet', 'doc', 'doc', 'slides', undefined, undefined],
    actual: [
      conversionTarget(XLSX_MIME),
      conversionTarget('text/csv'),
      conversionTarget('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      conversionTarget('application/pdf'),
      conversionTarget('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      conversionTarget(WORKSPACE_MIME.sheet),
      conversionTarget('image/png'),
    ],
  })
})

test('copyFile', async () => {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })

  const bodies: string[] = []
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body))
    return new Response(JSON.stringify({ id: 'f2', name: 'Atlas Copy', mimeType: WORKSPACE_MIME.sheet }), {
      status: 200,
    })
  }) as typeof fetch
  const client = new GoogleClient({
    secrets,
    email: 'jane@example.com',
    client: { clientId: 'id', clientSecret: 'sec' },
    fetchFn,
    sleep: async () => {},
  })

  await copyFile(client, 'f1', 'Atlas Copy')
  await copyFile(client, 'f1', 'Atlas Copy', { mimeType: WORKSPACE_MIME.sheet })
  await copyFile(client, 'f1', 'Atlas Copy', {
    mimeType: WORKSPACE_MIME.sheet,
    appProperties: { skyConvertedFrom: 'f1' },
  })

  assert({
    given: 'a plain copy, a converting copy, and a converting copy stamped with app properties',
    should: 'send only the name for the plain copy, and the conversion target and stamp when given',
    expected: [
      '{"name":"Atlas Copy"}',
      `{"name":"Atlas Copy","mimeType":"${WORKSPACE_MIME.sheet}"}`,
      `{"name":"Atlas Copy","mimeType":"${WORKSPACE_MIME.sheet}","appProperties":{"skyConvertedFrom":"f1"}}`,
    ],
    actual: bodies,
  })
})

test('importFileAsDoc', async () => {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })

  const requests: Array<{ url: string; body: string }> = []
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), body: new TextDecoder().decode(init?.body as Uint8Array) })
    return new Response(JSON.stringify({ id: 'f1', name: 'Atlas MSA', mimeType: WORKSPACE_MIME.doc }), {
      status: 200,
    })
  }) as typeof fetch
  const client = new GoogleClient({
    secrets,
    email: 'jane@example.com',
    client: { clientId: 'id', clientSecret: 'sec' },
    fetchFn,
    sleep: async () => {},
  })

  await importFileAsDoc(client, {
    title: 'Atlas MSA',
    data: new TextEncoder().encode('%PDF-1.7'),
    contentType: 'application/pdf',
    ocrLanguage: 'en',
  })

  const url = new URL(requests[0].url)
  assert({
    given: 'a PDF import with an OCR hint',
    should: 'multipart-upload with the hint on the query string',
    expected: ['multipart', 'en'],
    actual: [url.searchParams.get('uploadType'), url.searchParams.get('ocrLanguage')],
  })

  assert({
    given: 'the multipart body',
    should: 'pair Doc-conversion metadata with the original content type and bytes',
    expected: [true, true, true],
    actual: [
      requests[0].body.includes(`"mimeType":"${WORKSPACE_MIME.doc}"`),
      requests[0].body.includes('Content-Type: application/pdf'),
      requests[0].body.includes('%PDF-1.7'),
    ],
  })
})

test('every files and permissions request opts into shared drives', async () => {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })

  const urls: string[] = []
  const fetchFn = (async (url: unknown) => {
    urls.push(String(url))
    return new Response(JSON.stringify({ files: [] }), { status: 200 })
  }) as typeof fetch
  const client = new GoogleClient({
    secrets,
    email: 'jane@example.com',
    client: { clientId: 'id', clientSecret: 'sec' },
    fetchFn,
    sleep: async () => {},
  })

  await searchFiles(client, { text: 'atlas' })
  await getFile(client, 'f1')
  await copyFile(client, 'f1', 'Atlas Copy')
  await renameFile(client, 'f1', 'Atlas Copy v2')
  await deleteFile(client, 'f1')
  await shareFile(client, 'f1', { role: 'reader', emailAddress: 'jane@example.com' })
  await uploadFile(client, { name: 'logo.png', mimeType: 'image/png', data: new Uint8Array([1]) })
  await createDocFromMarkdown(client, { title: 'Atlas Plan', markdown: '# Hi' })
  await importFileAsDoc(client, { title: 'Atlas MSA', data: new Uint8Array([1]), contentType: 'application/pdf' })
  await replaceFileWithMarkdown(client, 'f1', '# Hi')
  await exportFile(client, 'f1', 'text/plain')

  assert({
    given: 'every Drive files/permissions call plus a files.export',
    should: 'carry supportsAllDrives everywhere except export, which has no such switch',
    expected: ['true', 'true', 'true', 'true', 'true', 'true', 'true', 'true', 'true', 'true', null],
    actual: urls.map((u) => new URL(u).searchParams.get('supportsAllDrives')),
  })

  assert({
    given: 'a files.list search',
    should: 'also opt its results in via includeItemsFromAllDrives',
    expected: 'true',
    actual: new URL(urls[0]).searchParams.get('includeItemsFromAllDrives'),
  })
})
