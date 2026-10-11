import { afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { createAgentTools, createMissionState } from '#commands/all/google/agent/lib/tools.ts'
import { READ_LIMIT_CHARS, readWorkspaceFile } from '#commands/all/google/lib/readWorkspaceFile.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { GoogleClient } from './client.ts'
import { DocSnapshotStore } from './docSnapshots.ts'
import { restyleDoc } from './docsRestyle.ts'
import { WORKSPACE_MIME } from './drive.ts'
import { saveAccountTokens } from './tokens.ts'

const root = mkdtempSync(path.join(tmpdir(), 'sky-doc-snapshot-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let fixtureCount = 0
const FILE_ID = 'atlas-doc'

async function fixture(email = 'jane@example.com', cacheRoot = path.join(root, String(fixtureCount++))) {
  const snapshots = new DocSnapshotStore(cacheRoot)
  const state = {
    version: 1,
    title: 'Atlas Plan',
    text: 'Atlas overview\n',
    font: 'Arial',
    paragraphs: 1,
    denied: false,
    canEdit: true,
    canComment: true,
    revisionSuffix: '',
    onExport: undefined as (() => void) | undefined,
    onWrite: undefined as (() => void) | undefined,
  }
  const calls = { metadata: 0, documents: 0, exports: 0, revisions: 0, writes: 0 }
  const bodies: Array<{ requests: Array<Record<string, unknown>>; writeControl?: { requiredRevisionId?: string } }> = []
  const revision = () => `revision-${state.version}${state.revisionSuffix}`
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, email, { refreshToken: 'rt', accessToken: 'at', scopes: [] })
  const client = new GoogleClient({
    secrets,
    email,
    client: { clientId: 'id', clientSecret: 'secret' },
    sleep: async () => {},
    fetchFn: (async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith(':batchUpdate')) {
        calls.writes++
        const body = JSON.parse(String(init?.body)) as (typeof bodies)[number]
        bodies.push(body)
        state.onWrite?.()
        if (body.writeControl?.requiredRevisionId !== revision()) {
          return json({ error: { message: 'The required revision ID does not match the current revision.' } }, 400)
        }
        state.version++
        for (const request of body.requests) {
          if (request.insertText) state.text += (request.insertText as { text: string }).text
          if (request.updateTextStyle) {
            const style = (request.updateTextStyle as { textStyle?: { weightedFontFamily?: { fontFamily?: string } } })
              .textStyle
            state.font = style?.weightedFontFamily?.fontFamily ?? state.font
          }
        }
        return json({
          replies: body.requests.map((request) =>
            request.addDocumentTab ? { addDocumentTab: { tabProperties: { tabId: 't.new' } } } : {},
          ),
          writeControl: { requiredRevisionId: revision() },
        })
      }
      if (url.pathname.endsWith('/export')) {
        calls.exports++
        state.onExport?.()
        return new Response(`# ${state.title}\n${state.text}`)
      }
      if (url.hostname === 'docs.googleapis.com') {
        const suggestionsViewMode =
          state.canEdit || state.canComment ? 'SUGGESTIONS_INLINE' : 'PREVIEW_WITHOUT_SUGGESTIONS'
        if (
          url.searchParams.get('suggestionsViewMode') === 'SUGGESTIONS_INLINE' &&
          suggestionsViewMode !== 'SUGGESTIONS_INLINE'
        ) {
          return json({ error: { message: 'This account cannot view suggestions.' } }, 403)
        }
        if (url.searchParams.get('fields') === 'revisionId,suggestionsViewMode') {
          calls.revisions++
          return json({ revisionId: state.canEdit ? revision() : undefined, suggestionsViewMode })
        }
        calls.documents++
        return json({
          documentId: FILE_ID,
          title: state.title,
          revisionId: state.canEdit ? revision() : undefined,
          suggestionsViewMode,
          tabs: [
            {
              tabProperties: { tabId: 't.main', title: 'Overview', nestingLevel: 0 },
              documentTab: {
                body: {
                  content: Array.from({ length: state.paragraphs }, (_, index) => ({
                    startIndex: index * state.text.length + 1,
                    endIndex: (index + 1) * state.text.length + 1,
                    paragraph: {
                      paragraphStyle: {
                        namedStyleType: index % 2 === 0 ? 'HEADING_1' : 'NORMAL_TEXT',
                        headingId: 'h.overview',
                      },
                      elements: [
                        {
                          startIndex: index * state.text.length + 1,
                          endIndex: (index + 1) * state.text.length + 1,
                          textRun: {
                            content: state.text,
                            textStyle: { weightedFontFamily: { fontFamily: state.font } },
                          },
                        },
                      ],
                    },
                  })),
                },
              },
            },
          ],
        })
      }
      calls.metadata++
      if (state.denied) return json({ error: { message: 'Access denied' } }, 403)
      return json({
        id: FILE_ID,
        name: state.title,
        mimeType: WORKSPACE_MIME.doc,
        version: String(state.version),
        capabilities: { canEdit: state.canEdit, canComment: state.canComment },
      })
    }) as typeof fetch,
  })
  const tools = () =>
    createAgentTools({
      client,
      snapshots,
      state: createMissionState(),
      log: () => {},
      missionModel: { model: 'test:google-agent' },
      critiquePrompt: '',
      deckCritiquePrompt: '',
      docCritiquePrompt: '',
    })
  return { client, snapshots, state, calls, bodies, tools }
}

test('document snapshots persist across readers and reuse unchanged content with one metadata request', async () => {
  const f = await fixture()
  const first = await readWorkspaceFile(f.client, { fileId: FILE_ID }, { snapshots: f.snapshots })
  const afterFirst = { ...f.calls }
  const restarted = new DocSnapshotStore(f.snapshots.root)
  const second = await readWorkspaceFile(f.client, { fileId: FILE_ID, tabId: 't.main' }, { snapshots: restarted })
  const outline = await restarted.read(f.client, FILE_ID)
  const saved = JSON.parse(await readFile(restarted.filePath(f.client.email, FILE_ID), 'utf8'))
  assert({
    given: 'a full read, then a new store instance reading a tab and outline',
    should: 'capture once and check only metadata for each subsequent read',
    actual: {
      afterFirst,
      final: f.calls,
      first: first.ok && first.read.content,
      tab: second.ok && second.read.content,
      heading: outline.outline.headings?.[0]?.text,
      version: saved.file.version,
      savedFont:
        saved.document.tabs[0].documentTab.body.content[0].paragraph.elements[0].textRun.textStyle.weightedFontFamily
          .fontFamily,
    },
    expected: {
      afterFirst: { metadata: 2, documents: 1, exports: 1, revisions: 0, writes: 0 },
      final: { metadata: 4, documents: 1, exports: 1, revisions: 0, writes: 0 },
      first: '# Atlas Plan\nAtlas overview\n',
      tab: 'Atlas overview\n',
      heading: 'Atlas overview',
      version: '1',
      savedFont: 'Arial',
    },
  })
})

test('document snapshots refresh after content or metadata changes', async () => {
  const f = await fixture()
  await f.snapshots.read(f.client, FILE_ID)
  f.state.version++
  f.state.text = 'Updated overview\n'
  const changed = await f.snapshots.read(f.client, FILE_ID)
  f.state.version++
  f.state.title = 'Atlas Revised Plan'
  const renamed = await f.snapshots.read(f.client, FILE_ID)
  assert({
    given: 'content and then a title change',
    should: 'refresh text and structure for each new version',
    actual: [changed.file.version, changed.tabs[0]?.text, renamed.file.name, renamed.outline.title, f.calls.exports],
    expected: ['2', 'Updated overview\n', 'Atlas Revised Plan', 'Atlas Revised Plan', 3],
  })
})

test('document snapshots retry a capture changed by a collaborator', async () => {
  const f = await fixture()
  f.state.onExport = () => {
    if (f.calls.exports === 1) {
      f.state.version++
      f.state.text = 'Collaborator update\n'
    }
  }
  const snapshot = await f.snapshots.read(f.client, FILE_ID)
  assert({
    given: 'a change between the structure fetch and the export',
    should: 'save a consistent second capture',
    actual: [snapshot.file.version, snapshot.tabs[0]?.text, snapshot.markdown, f.calls.exports],
    expected: ['2', 'Collaborator update\n', '# Atlas Plan\nCollaborator update\n', 2],
  })
})

test('document snapshots bound retries when a document keeps changing', async () => {
  const f = await fixture()
  f.state.onExport = () => {
    f.state.version++
  }
  const message = await f.snapshots.read(f.client, FILE_ID).then(
    () => '',
    (e: Error) => e.message,
  )
  const saved = await readFile(f.snapshots.filePath(f.client.email, FILE_ID), 'utf8').catch(() => undefined)
  assert({
    given: 'changes during every capture',
    should: 'stop with an actionable error and leave no mixed snapshot',
    actual: [message.includes('Atlas Plan'), message.includes('kept changing'), f.calls.exports, saved],
    expected: [true, true, 3, undefined],
  })
})

test('document snapshots never serve cached content after access is lost', async () => {
  const f = await fixture()
  await f.snapshots.read(f.client, FILE_ID)
  f.state.denied = true
  const error = await f.snapshots.read(f.client, FILE_ID).then(
    () => '',
    (e: Error) => e.message,
  )
  assert({
    given: 'a warm cache and a failed authorization check',
    should: 'surface the failure without serving the cache',
    actual: [error.includes('403'), f.calls.exports],
    expected: [true, 1],
  })
})

test('document snapshots support view-only accounts and refresh after access changes', async () => {
  const f = await fixture()
  f.state.canEdit = false
  f.state.canComment = false
  const tools = f.tools()
  const read = (await tools.read_file.execute({ fileId: FILE_ID })) as Record<string, unknown>
  const refused = await tools.batch_update_doc.execute({
    fileId: FILE_ID,
    requests: [{ insertText: { location: { index: 1 }, text: 'Update' } }],
  })
  await tools.read_file.execute({ fileId: FILE_ID })
  f.state.canEdit = true
  const editable = await f.snapshots.read(f.client, FILE_ID, { forEditing: true })
  f.state.canEdit = false
  const downgraded = await f.snapshots.read(f.client, FILE_ID)
  assert({
    given: 'view access, then edit access, then view access with the same Drive version',
    should: 'read without forcing inline suggestions and rebuild whenever capabilities change',
    actual: [
      read.content,
      String(refused).includes('edit access'),
      f.calls.writes,
      editable.document.suggestionsViewMode,
      editable.document.revisionId,
      downgraded.document.suggestionsViewMode,
      downgraded.document.revisionId,
    ],
    expected: [
      '# Atlas Plan\nAtlas overview\n',
      true,
      0,
      'SUGGESTIONS_INLINE',
      'revision-1',
      'PREVIEW_WITHOUT_SUGGESTIONS',
      undefined,
    ],
  })
})

test('document snapshots rebuild corrupted files and tolerate unavailable cache storage', async () => {
  const f = await fixture()
  await f.snapshots.read(f.client, FILE_ID)
  await writeFile(f.snapshots.filePath(f.client.email, FILE_ID), '{partial')
  const rebuilt = await f.snapshots.read(f.client, FILE_ID)
  const blocked = path.join(f.snapshots.root, 'not-a-directory')
  await writeFile(blocked, 'occupied')
  const uncached = await new DocSnapshotStore(blocked).read(f.client, FILE_ID)
  assert({
    given: 'a damaged cache and then an unwritable cache path',
    should: 'return authenticated live snapshots',
    actual: [rebuilt.file.version, uncached.file.version, f.calls.exports],
    expected: ['1', '1', 3],
  })
})

test('document snapshots isolate accounts and coalesce concurrent captures', async () => {
  const f = await fixture()
  await Promise.all([f.snapshots.read(f.client, FILE_ID), f.snapshots.read(f.client, FILE_ID)])
  const other = await fixture('joe@example.com', f.snapshots.root)
  other.state.text = 'Account-specific text\n'
  const snapshot = await other.snapshots.read(other.client, FILE_ID)
  assert({
    given: 'two concurrent reads and another account using the same document ID',
    should: 'capture once per account without sharing document state across accounts',
    actual: [
      f.calls.exports,
      other.calls.exports,
      snapshot.tabs[0]?.text,
      f.snapshots.filePath(f.client.email, FILE_ID) !== other.snapshots.filePath(other.client.email, FILE_ID),
    ],
    expected: [1, 1, 'Account-specific text\n', true],
  })
})

test('document snapshots renew expired edit tokens without downloading unchanged content', async () => {
  const f = await fixture()
  await f.snapshots.read(f.client, FILE_ID)
  const target = f.snapshots.filePath(f.client.email, FILE_ID)
  const saved = JSON.parse(await readFile(target, 'utf8'))
  saved.revisionFetchedAtMs = 0
  await writeFile(target, JSON.stringify(saved))
  f.state.revisionSuffix = '-renewed'
  const snapshot = await f.snapshots.read(f.client, FILE_ID, { forEditing: true })
  assert({
    given: 'an unchanged file with an expired, account-specific edit token',
    should: 'renew only the revision ID and confirm that the cached content still matches',
    actual: [snapshot.document.revisionId, f.calls.documents, f.calls.exports, f.calls.revisions],
    expected: ['revision-1-renewed', 1, 1, 1],
  })
})

test('document pagination reuses one export and refuses mixed versions', async () => {
  const f = await fixture()
  f.state.text = 'x'.repeat(READ_LIMIT_CHARS + 10)
  const first = await readWorkspaceFile(f.client, { fileId: FILE_ID }, { snapshots: f.snapshots })
  const second = await readWorkspaceFile(
    f.client,
    { fileId: FILE_ID, offset: READ_LIMIT_CHARS, version: '1' },
    { snapshots: f.snapshots },
  )
  f.state.version++
  const stale = await readWorkspaceFile(
    f.client,
    { fileId: FILE_ID, offset: READ_LIMIT_CHARS, version: '1' },
    { snapshots: f.snapshots },
  )
  assert({
    given: 'two pages of one revision followed by a collaborator change',
    should: 'export once, carry the continuation version, and refuse to splice in a new revision',
    actual: [
      first.ok && first.read.content.includes('version: 1'),
      second.ok && second.read.page.complete,
      stale.ok,
      !stale.ok && stale.message.includes('restart at offset 0'),
      f.calls.exports,
    ],
    expected: [true, true, false, true, 1],
  })
})

test('Google Agent shares the chat snapshot and guards edits with the observed revision', async () => {
  const f = await fixture()
  await readWorkspaceFile(f.client, { fileId: FILE_ID }, { snapshots: f.snapshots })
  const tools = f.tools()
  await tools.get_doc_outline.execute({ fileId: FILE_ID })
  const first = await tools.batch_update_doc.execute({
    fileId: FILE_ID,
    requests: [{ addDocumentTab: { tabProperties: { title: 'Notes' } } }],
  })
  const second = await tools.batch_update_doc.execute({
    fileId: FILE_ID,
    requests: [{ insertText: { endOfSegmentLocation: {}, text: 'Added\n' } }],
  })
  const read = (await tools.read_file.execute({ fileId: FILE_ID })) as Record<string, unknown>
  assert({
    given: 'a chat read, an agent outline, two edits and a read-back',
    should: 'reuse the initial snapshot, chain write revisions, expose created IDs and refresh after the writes',
    actual: [first, second, f.bodies.map((b) => b.writeControl?.requiredRevisionId), f.calls.exports, read.content],
    expected: [
      { applied: 1, replies: [{ addDocumentTab: { tabProperties: { tabId: 't.new' } } }] },
      { applied: 1, replies: [] },
      ['revision-1', 'revision-2'],
      2,
      '# Atlas Plan\nAtlas overview\nAdded\n',
    ],
  })
})

test('Google Agent refuses stale edits and requires a new read before retrying', async () => {
  const f = await fixture()
  const tools = f.tools()
  await tools.get_doc_outline.execute({ fileId: FILE_ID })
  f.state.version++
  f.state.text = 'Collaborator text\n'
  const requests = [{ insertText: { location: { index: 1 }, text: 'Proposed\n' } }]
  const rejected = await tools.batch_update_doc.execute({ fileId: FILE_ID, requests })
  const refused = await tools.batch_update_doc.execute({ fileId: FILE_ID, requests })
  const writes = f.calls.writes
  await tools.get_doc_outline.execute({ fileId: FILE_ID })
  const applied = await tools.batch_update_doc.execute({ fileId: FILE_ID, requests })
  assert({
    given: 'an edit prepared before another person changes the document',
    should: 'reject the old revision, stop blind retries, and permit a newly read revision',
    actual: [
      String(rejected).includes('re-read document'),
      String(refused).includes('no current document revision'),
      writes,
      applied,
      f.bodies.map((b) => b.writeControl?.requiredRevisionId),
    ],
    expected: [true, true, 1, { applied: 1, replies: [] }, ['revision-1', 'revision-2']],
  })
})

test('deterministic restyling also refuses concurrent document changes', async () => {
  const f = await fixture()
  f.state.onWrite = () => {
    f.state.version++
    f.state.text = 'Collaborator text\n'
  }
  const message = await restyleDoc(f.client, FILE_ID, { fontFamily: 'Inter' }).then(
    () => '',
    (e: Error) => e.message,
  )
  assert({
    given: 'a collaborator changes the document after typography ranges were planned',
    should: 'send the original revision and fail without changing the font',
    actual: [message.includes('revision'), f.bodies[0]?.writeControl?.requiredRevisionId, f.state.font, f.calls.writes],
    expected: [true, 'revision-1', 'Arial', 1],
  })
})

test('outline and tab reads defer markdown exports until a full document read', async () => {
  const f = await fixture()
  const tools = f.tools()
  await tools.get_doc_outline.execute({ fileId: FILE_ID })
  const tab = (await tools.read_file.execute({ fileId: FILE_ID, tabId: 't.main' })) as Record<string, unknown>
  const beforeExport = { ...f.calls }
  const full = (await tools.read_file.execute({ fileId: FILE_ID })) as Record<string, unknown>
  assert({
    given: 'an outline followed by a tab read and a whole-document read',
    should: 'reuse the structure and fetch markdown only when requested',
    actual: [
      beforeExport.documents,
      beforeExport.exports,
      tab.content,
      f.calls.documents,
      f.calls.exports,
      full.content,
    ],
    expected: [1, 0, 'Atlas overview\n', 1, 1, '# Atlas Plan\nAtlas overview\n'],
  })
})

test('a lazy export cannot attach changed content to an older structure', async () => {
  const f = await fixture()
  await f.snapshots.read(f.client, FILE_ID, { includeMarkdown: false })
  f.state.onExport = () => {
    if (f.calls.exports === 1) {
      f.state.version++
      f.state.text = 'Concurrent update\n'
    }
  }
  const snapshot = await f.snapshots.read(f.client, FILE_ID)
  assert({
    given: 'a change while adding markdown to a cached structure',
    should: 'discard the mixed result and capture both representations at the new version',
    actual: [snapshot.file.version, snapshot.markdown, snapshot.tabs[0]?.text, f.calls.documents, f.calls.exports],
    expected: ['2', '# Atlas Plan\nConcurrent update\n', 'Concurrent update\n', 2, 2],
  })
})

test('restyling across several batches advances the required revision after each successful write', async () => {
  const f = await fixture()
  f.state.paragraphs = 121
  const result = await restyleDoc(f.client, FILE_ID, { sizes: { heading1: 14, body: 11 } })
  assert({
    given: 'more style ranges than one Docs batch accepts',
    should: 'guard each batch with the revision returned by its predecessor',
    actual: [result.batches, f.bodies.map((body) => body.writeControl?.requiredRevisionId), f.calls.documents],
    expected: [2, ['revision-1', 'revision-2'], 2],
  })
})

test('outline versions keep legitimate rereads out of the identical-result repetition guard', async () => {
  const f = await fixture()
  const tools = f.tools()
  const versions: unknown[] = []
  for (let i = 0; i < 3; i++) {
    const result = (await tools.get_doc_outline.execute({ fileId: FILE_ID })) as Record<string, unknown>
    versions.push(result.version)
    f.state.version++
  }
  assert({
    given: 'three reads whose heading structure is unchanged but whose document versions differ',
    should: 'return each observed version instead of refusing the third read as a duplicate',
    actual: versions,
    expected: ['1', '2', '3'],
  })
})
