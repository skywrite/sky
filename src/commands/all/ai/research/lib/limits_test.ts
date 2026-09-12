import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { CommandResult, type CommandService } from '#commands/mod.ts'
import { makeTempDir, writeTextFile } from '#shared/fs/mod.ts'
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
