import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { loadMemories, renderPreferenceBlock } from '#shared/models/Memory/mod.ts'
import { assert, test } from '#test'
import { createMemoryTools, rememberMemory, searchMemories, type MemoryToolsOptions } from './memoryTools.ts'

const preference = {
  kind: 'preference' as const,
  summary: 'Use metric units',
  body: 'The user prefers measurements in metric units.',
}

async function fixture(run: (options: MemoryToolsOptions) => Promise<void>) {
  const notebookDir = await mkdtemp(path.join(tmpdir(), 'sky-chat-memory-'))
  try {
    await run({
      notebookDir,
      memoryDir: path.join(notebookDir, 'ai', 'memory'),
      source: '/chat/source/sample-conversation',
      today: () => '2031-03-16',
    })
  } finally {
    await rm(notebookDir, { recursive: true, force: true })
  }
}

test('remember writes immediately through the chat tool and future chats read the saved preference', async () => {
  await fixture(async (options) => {
    const tools = createMemoryTools(options)
    const result = (await tools.remember.execute!(preference, {
      toolCallId: 'remember-one',
      messages: [],
      context: {},
    })) as Awaited<ReturnType<typeof rememberMemory>>
    if (!result.success) throw new Error(result.error)
    const saved = await loadMemories(options.memoryDir)
    const markdown = await readFile(saved[0].path, 'utf8')
    assert({
      given: 'an explicit remember call while the conversation has not been filed',
      should: 'persist the memory now, return its exact text and review link, and load it in a fresh prompt',
      actual: [
        result.action,
        result.memory.body,
        result.memory.href,
        markdown.includes(`source: ${options.source}`),
        markdown.includes('created: 2031-03-16'),
        renderPreferenceBlock(saved),
      ],
      expected: [
        'create',
        preference.body,
        '/explorer/ai/memory/use-metric-units.md',
        true,
        true,
        `- ${preference.body}`,
      ],
    })
  })
})

test('remember retries do not duplicate a fact or silently replace a different memory', async () => {
  await fixture(async (options) => {
    await rememberMemory(preference, options)
    const before = await readFile(path.join(options.memoryDir, 'use-metric-units.md'), 'utf8')
    const retry = await rememberMemory({ ...preference, summary: 'Metric measurements' }, options)
    const conflict = await rememberMemory({ ...preference, body: 'Use miles for all distances.' }, options)
    assert({
      given: 'the same memory requested again and a different fact given the same title',
      should: 'acknowledge the existing fact and require an explicit revision before overwriting it',
      actual: [
        retry.success && retry.action,
        conflict.success,
        (await loadMemories(options.memoryDir)).length,
        (await readFile(path.join(options.memoryDir, 'use-metric-units.md'), 'utf8')) === before,
      ],
      expected: ['unchanged', false, 1, true],
    })
  })
})

test('memory search supplies revisions and corrections retain identity while protecting later edits', async () => {
  await fixture(async (options) => {
    await rememberMemory(preference, options)
    const found = await searchMemories({ query: 'metric' }, options)
    if (!found.success) throw new Error(found.error)
    const { id, revision } = found.memories[0]
    const corrected = { ...preference, id, revision, body: 'Use metric units, except miles for road distances.' }
    const updated = await rememberMemory(corrected, { ...options, source: '/chat/source/correction' })
    const stale = await rememberMemory({ ...corrected, body: 'Use imperial units.' }, options)
    const file = path.join(options.memoryDir, `${id}.md`)
    const markdown = await readFile(file, 'utf8')
    assert({
      given: 'a correction based on a searched memory and a second correction using its stale revision',
      should: 'save the first correction with provenance and refuse to overwrite it with stale content',
      actual: [
        updated.success && updated.action,
        stale.success,
        markdown.includes(corrected.body),
        markdown.includes('source: /chat/source/correction'),
        (await loadMemories(options.memoryDir)).length,
      ],
      expected: ['update', false, true, true, 1],
    })
  })
})

test('memory writes report locked targets, cancellation and disk failures without claiming success', async () => {
  await fixture(async (options) => {
    await rememberMemory(preference, options)
    const file = path.join(options.memoryDir, 'use-metric-units.md')
    await writeFile(file, (await readFile(file, 'utf8')).replace('kind: preference', 'locked: true\nkind: preference'))
    const found = await searchMemories({}, options)
    if (!found.success) throw new Error(found.error)
    const { id, revision } = found.memories[0]
    const locked = await rememberMemory({ ...preference, id, revision, body: 'Use imperial units.' }, options)
    const aborted = await rememberMemory(
      { ...preference, body: 'An unsaved instruction.' },
      options,
      AbortSignal.abort(),
    )
    const notDirectory = path.join(options.notebookDir, 'not-a-directory')
    await writeFile(notDirectory, 'Keep this file.')
    const failed = await rememberMemory(preference, { ...options, memoryDir: notDirectory })
    assert({
      given: 'a locked memory, an already stopped call, and an unusable memory directory',
      should: 'return honest failures and preserve the existing content',
      actual: [
        locked.success,
        !locked.success && locked.error.includes('locked'),
        aborted.success,
        failed.success,
        (await readFile(file, 'utf8')).includes(preference.body),
        await readFile(notDirectory, 'utf8'),
      ],
      expected: [false, true, false, false, true, 'Keep this file.'],
    })
  })
})

test('memory writes reject traversal and linked files and reserve new names when calls race', async () => {
  await fixture(async (options) => {
    const outside = path.join(options.notebookDir, 'outside.md')
    await writeFile(outside, 'Keep this note.')
    await mkdir(options.memoryDir, { recursive: true })
    await symlink(outside, path.join(options.memoryDir, 'linked-memory.md'))
    const traversal = await rememberMemory({ ...preference, id: '../outside', revision: '0'.repeat(64) }, options)
    const linked = await rememberMemory({ ...preference, summary: 'Linked memory' }, options)
    const raced = await Promise.all([
      rememberMemory(preference, options),
      rememberMemory({ ...preference, body: 'A different instruction using the same title.' }, options),
    ])
    assert({
      given: 'an invalid id, a symlink target, and concurrent new memories with one title',
      should: 'protect other files and allow only one creation instead of overwriting it',
      actual: [
        traversal.success,
        linked.success,
        await readFile(outside, 'utf8'),
        raced.filter((r) => r.success).length,
      ],
      expected: [false, false, 'Keep this note.', 1],
    })
  })
})
