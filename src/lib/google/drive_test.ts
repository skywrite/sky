import { assert, test } from '#test'
import {
  EXPORT_MIME,
  WORKSPACE_MIME,
  buildBinaryMultipartBody,
  buildFilesQuery,
  buildMultipartBody,
  escapeDriveQueryValue,
  workspaceKind,
} from './drive.ts'

test('buildFilesQuery', () => {
  assert({
    given: 'no options',
    should: 'match untrashed files of all three workspace kinds',
    expected:
      "trashed = false and (mimeType = 'application/vnd.google-apps.document'" +
      " or mimeType = 'application/vnd.google-apps.spreadsheet'" +
      " or mimeType = 'application/vnd.google-apps.presentation')",
    actual: buildFilesQuery(),
  })

  assert({
    given: 'a kind filter',
    should: 'match only that mime type',
    expected: "trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'",
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
})
