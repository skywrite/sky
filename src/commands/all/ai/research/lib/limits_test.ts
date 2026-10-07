import { mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { CommandResult, type CommandService } from '#commands/mod.ts'
import { readDocumentPages } from '#service/context/document.ts'
import { makeTempDir, writeTextFile } from '#shared/fs/mod.ts'
import { cleanDocumentText } from '#shared/models/AI/DocumentPages/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createResearchTools } from './tools.ts'

const NULL_STORE = {
  resolveAll: () => [],
  resolve: () => ({ type: 'unresolved', value: null, raw: '' }),
} as unknown as MarkdownStore

test('research bounds an oversized query document and can recover a passage near its end', async () => {
  const baseDir = await makeTempDir({ prefix: 'sky-research-limits-' })
  try {
    const file = path.join(baseDir, 'demo.md')
    const needle = 'Atlas decision: proceed with the demo.'
    const markdown = `---\ntitle: Demo chat\n---\n${'Synthetic transcript with "quotes", \\slashes, İ and 😀.\n'.repeat(180_000)}${needle}`
    await writeTextFile(file, markdown)
    const trace = { sources: new Set<string>() }
    const tools = createResearchTools({
      tasks: { run: async () => CommandResult.success({ paths: [file] }) } as unknown as CommandService,
      baseDir,
      today: new PlainDate('2026-01-27'),
      trace,
      contextTokens: 1000,
      loadStore: async () => NULL_STORE,
      fetchPages: (requests) => readDocumentPages(baseDir, requests),
    })
    const result = await tools.notebook_query.execute({ graphql: '{ chats { path markdown } }' })
    if (!('documents' in result)) throw new Error('Expected a document result')
    const first = result.documents[0]
    const continuation = await tools.notebook_read.execute({ path: first.path, offset: first.nextOffset })
    const found = await tools.notebook_read.execute({ path: first.path, find: needle })
    if (!('markdown' in continuation) || !('markdown' in found)) throw new Error('Expected readable document pages')
    assert({
      given: 'a multi-megabyte chat admitted despite the assembler budget',
      should: 'return a bounded, labeled excerpt and recover original text by offset and search',
      actual: {
        bounded: [result, continuation, found].every((value) => JSON.stringify(value).length <= 4000),
        counts: [result.matched, result.rendered],
        partial: first.truncated,
        total: first.totalChars,
        original:
          first.markdown + continuation.markdown ===
          markdown.slice(0, first.markdown.length + continuation.markdown.length),
        wellFormed: first.markdown.isWellFormed() && continuation.markdown.isWellFormed(),
        found: found.markdown.includes(needle),
        sources: [...trace.sources],
      },
      expected: {
        bounded: true,
        counts: [1, 1],
        partial: true,
        total: markdown.length,
        original: true,
        wellFormed: true,
        found: true,
        sources: ['demo.md'],
      },
    })
  } finally {
    await rm(baseDir, { recursive: true, force: true })
  }
})

test('a zero research budget never queries or reads the notebook', async () => {
  let calls = 0
  const tools = createResearchTools({
    tasks: {
      run: async () => {
        calls++
        return CommandResult.success({ paths: [] })
      },
    } as unknown as CommandService,
    baseDir: '/mock-notebook',
    today: new PlainDate('2026-01-27'),
    trace: { sources: new Set() },
    contextTokens: 0,
    loadStore: async () => {
      calls++
      return NULL_STORE
    },
  })
  const results = await Promise.all([
    tools.notebook_query.execute({ graphql: '{ chats { path markdown } }' }),
    tools.notebook_read.execute({ path: 'demo.md' }),
    tools.person_lookup.execute({ name: 'Jane Doe' }),
  ])
  assert({
    given: 'notebook reading is disabled in the parent chat',
    should: 'reject every research read before accessing the notebook',
    actual: { calls, rejected: results.every((result) => 'success' in result && result.success === false) },
    expected: { calls: 0, rejected: true },
  })
})

test('a capped query result keeps the documents that match the question, not the newest', async () => {
  const baseDir = await makeTempDir({ prefix: 'sky-research-rank-' })
  try {
    const today = PlainDate.today()
    const at = (daysAgo: number, name: string) => {
      const d = today.addDays(-daysAgo)
      return path.join(
        baseDir,
        'time',
        d.toString().slice(0, 4),
        'W40',
        d.toString().slice(5),
        'actions',
        'messages',
        name,
      )
    }
    // Realistic message sizes: a tiny fixture would be cut by the page cap's
    // per-document overhead before the assembler's budget could decide.
    const filler = 'Notes on the garden, the weather, and what to cook for lunch tomorrow.\n'.repeat(22)
    const files = [
      [
        at(1, 'slack_Alice-to-Bob_Weekly-sync.md'),
        `---\nfrom: Alice Smith\nto: Bob Jones\nsummary: Weekly sync\n---\nA passing word about the atlas rollout among many other things this week.\n${filler}`,
      ],
      [
        at(2, 'slack_Alice-to-Bob_Standup.md'),
        `---\nfrom: Alice Smith\nto: Bob Jones\nsummary: Standup\n---\nNothing about the rollout today.\n${filler}`,
      ],
      [
        at(20, 'slack_Alice-to-Bob_Atlas-rollout-checklist.md'),
        `---\nfrom: Alice Smith\nto: Bob Jones\nsummary: Atlas rollout checklist\n---\nThe atlas rollout checklist, step by step.\n${filler}`,
      ],
    ] as const
    for (const [file, markdown] of files) {
      await mkdir(path.dirname(file), { recursive: true })
      await writeTextFile(file, markdown)
    }
    const tools = createResearchTools({
      tasks: {
        run: async () => CommandResult.success({ paths: files.map(([file]) => file) }),
      } as unknown as CommandService,
      baseDir,
      today,
      trace: { sources: new Set() },
      // Each document is about 420 tokens: room for two of the three.
      contextTokens: 1000,
      loadStore: async () => NULL_STORE,
      fetchPages: (requests) => readDocumentPages(baseDir, requests),
      question: 'What is the status of the atlas rollout checklist?',
    })
    const result = await tools.notebook_query.execute({
      graphql: '{ messages(where: { bodyContains: "rollout" }) { path markdown } }',
    })
    if (!('documents' in result)) throw new Error('Expected a document result')
    assert({
      given: 'three matches, a budget for two, and a question about the rollout checklist',
      should: 'keep the titled checklist and the mention that match the question, and drop the newer unrelated standup',
      actual: result.documents.map((d) => path.basename(d.path).split('_').pop()).sort(),
      expected: ['Atlas-rollout-checklist.md', 'Weekly-sync.md'],
    })
  } finally {
    await rm(baseDir, { recursive: true, force: true })
  }
})

test("a matched chat's context log never reaches the research agent", async () => {
  const baseDir = await makeTempDir({ prefix: 'sky-research-log-' })
  try {
    const rel = 'time/2026/W40/10-01/actions/ai-chats/2026-10-01_090000_Atlas-sync.md'
    const body =
      '---\ncreated: 2026-10-01\nsummary: Atlas sync\n---\n\n## 2026-10-01 09:00 - **Jane Doe**\n\nWhere does the Atlas rollout stand?\n\n## 2026-10-01 09:01 - **Sky**\n\nThe checklist has two open steps.\n'
    const log = `\n<!-- CONTEXT-LOG\n${JSON.stringify({ version: 2, turns: [{ turn: 1, universe: Array.from({ length: 120 }, (_, i) => ({ path: `time/2026/W40/10-01/actions/messages/m${i}.md`, score: 12.5, tokens: 900 })) }] })}\n-->\n`
    const file = path.join(baseDir, rel)
    await mkdir(path.dirname(file), { recursive: true })
    await writeTextFile(file, body + log)
    const trace = { sources: new Set<string>() }
    const tools = createResearchTools({
      tasks: { run: async () => CommandResult.success({ paths: [file] }) } as unknown as CommandService,
      baseDir,
      today: new PlainDate('2026-10-02'),
      trace,
      contextTokens: 2000,
      loadStore: async () => NULL_STORE,
      fetchPages: (requests) => readDocumentPages(baseDir, requests),
    })
    const result = await tools.notebook_query.execute({ graphql: '{ chats { path markdown } }' })
    if (!('documents' in result)) throw new Error('Expected a document result')
    const read = await tools.notebook_read.execute({ path: rel, find: 'CONTEXT-LOG' })
    assert({
      given:
        'a chat whose log comment is more than ten times its conversation, under a budget the raw file would overflow',
      should: 'serve the conversation whole, size it by the served text, and find no log text to read',
      actual: {
        rendered: result.rendered,
        logInPage:
          result.documents[0]!.markdown.includes('CONTEXT-LOG') || result.documents[0]!.markdown.includes('"universe"'),
        truncated: result.documents[0]!.truncated,
        totalChars: result.documents[0]!.totalChars,
        logFound: 'found' in read ? read.found : 'page',
      },
      expected: {
        rendered: 1,
        logInPage: false,
        truncated: false,
        totalChars: cleanDocumentText(body + log).length,
        logFound: false,
      },
    })
  } finally {
    await rm(baseDir, { recursive: true, force: true })
  }
})
