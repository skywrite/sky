import { mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir, writeTextFile } from '#shared/fs/mod.ts'
import { cleanDocumentText } from '#shared/models/AI/DocumentPages/mod.ts'
import { assert, test } from '#test'
import { parseDocumentPageRequests, readDocumentPages } from './document.ts'

const CHAT_BODY =
  '---\ncreated: 2026-10-01\nsummary: Atlas sync\n---\n\n## 2026-10-01 09:00 - **Jane Doe**\n\nWhere does the Atlas rollout stand?\n\n## 2026-10-01 09:01 - **Sky**\n\nThe checklist has two open steps.\n'
const CHAT_LOG = `\n<!-- CONTEXT-LOG\n${JSON.stringify({ version: 2, turns: [{ turn: 1, universe: Array.from({ length: 120 }, (_, i) => ({ path: `time/2026/W40/10-01/actions/messages/m${i}.md`, score: 12.5, tokens: 900, lex: 4 })) }] })}\n-->\n`

test('a chat is served without its context log, with offsets in the served text', async () => {
  const baseDir = await makeTempDir({ prefix: 'sky-doc-pages-' })
  try {
    const rel = 'time/2026/W40/10-01/actions/ai-chats/2026-10-01_090000_Atlas-sync.md'
    await mkdir(path.dirname(path.join(baseDir, rel)), { recursive: true })
    await writeTextFile(path.join(baseDir, rel), CHAT_BODY + CHAT_LOG)
    const [page, byAbsolute, miss] = await readDocumentPages(baseDir, [
      { path: rel },
      { path: path.join(baseDir, rel), find: 'checklist' },
      { path: rel, find: 'CONTEXT-LOG' },
    ])
    if (!page || !('markdown' in page) || !byAbsolute || !('markdown' in byAbsolute)) throw new Error('expected pages')
    assert({
      given: 'a saved chat whose log comment is more than ten times its conversation',
      should:
        'page the conversation only, size it by the served text, accept an absolute path inside the notebook, and never find text that lives in the log',
      actual: {
        logInPage: page.markdown.includes('CONTEXT-LOG') || page.markdown.includes('"universe"'),
        totalChars: page.totalChars,
        truncated: page.truncated,
        nextOffset: page.nextOffset,
        logAtLeastTenTimesBody: CHAT_LOG.length >= 10 * CHAT_BODY.length,
        absoluteResolvesToRelative: byAbsolute.path === rel && byAbsolute.markdown.includes('checklist'),
        version: page.version === byAbsolute.version && page.version?.length === 12,
        miss: miss && 'found' in miss ? miss.found : 'page',
      },
      expected: {
        logInPage: false,
        totalChars: cleanDocumentText(CHAT_BODY + CHAT_LOG).length,
        truncated: false,
        nextOffset: undefined,
        logAtLeastTenTimesBody: true,
        absoluteResolvesToRelative: true,
        version: true,
        miss: false,
      },
    })
  } finally {
    await rm(baseDir, { recursive: true, force: true })
  }
})

test('a path outside the notebook or a missing file fails only its own request', async () => {
  const baseDir = await makeTempDir({ prefix: 'sky-doc-pages-' })
  try {
    await writeTextFile(path.join(baseDir, 'note.md'), '# Note\n')
    const results = await readDocumentPages(baseDir, [
      { path: '../outside.md' },
      { path: 'missing.md' },
      { path: 'note.md' },
    ])
    assert({
      given: 'an escaping path, a missing file and a readable one in a single batch',
      should: 'answer every request in order, with an error for the first two and a page for the third',
      actual: results.map((r) => ('error' in r ? r.error : 'markdown' in r ? r.markdown : 'miss')),
      expected: ['Path is outside the notebook.', 'No document at missing.md.', '# Note\n'],
    })
  } finally {
    await rm(baseDir, { recursive: true, force: true })
  }
})

test('the request body is validated before any file is read', () => {
  assert({
    given: 'bodies with no requests, a non-string path, an empty find, and a valid batch',
    should: 'reject the first two and normalize the rest',
    actual: [
      parseDocumentPageRequests({}),
      parseDocumentPageRequests({ requests: [{ path: 3 }] }),
      parseDocumentPageRequests({
        requests: [
          { path: 'a.md', find: '' },
          { path: 'b.md', offset: 10, length: 50, find: 'x' },
        ],
      }),
    ],
    expected: [null, null, [{ path: 'a.md' }, { path: 'b.md', offset: 10, length: 50, find: 'x' }]],
  })
})
