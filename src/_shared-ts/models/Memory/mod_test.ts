import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { loadMemories, MEMORY_BLOCK, renderPreferenceBlock } from './mod.ts'

async function memoryDirWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-test-'))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content)
  }
  return dir
}

const memoryFile = (fields: { kind?: string; summary?: string; lastConfirmed?: string; body: string }) =>
  [
    '---',
    'created: 2026-01-05',
    'updated: 2026-01-05',
    ...(fields.kind ? [`kind: ${fields.kind}`] : []),
    ...(fields.summary ? [`summary: ${fields.summary}`] : []),
    ...(fields.lastConfirmed ? [`lastConfirmed: ${fields.lastConfirmed}`] : []),
    '---',
    '',
    fields.body,
    '',
  ].join('\n')

test('loadMemories - parses kinds, summaries, and orders freshest first', async () => {
  const dir = await memoryDirWith({
    'answer-terse.md': memoryFile({
      kind: 'preference',
      summary: 'Terse answers',
      lastConfirmed: '2026-01-10',
      body: 'Keep answers terse.',
    }),
    'atlas-shorthand.md': memoryFile({
      kind: 'glossary',
      summary: 'The big deck means the Atlas overview deck',
      lastConfirmed: '2026-02-20',
      body: 'When Jane says "the big deck" she means the Atlas overview deck.',
    }),
    'mystery-kind.md': memoryFile({
      kind: 'hunch',
      body: 'A kind this version does not know.',
    }),
  })
  try {
    const memories = await loadMemories(dir)
    assert({
      given: 'three memory files with mixed kinds and dates',
      should: 'order freshest first with the undated one last',
      actual: memories.map((m) => m.slug),
      expected: ['atlas-shorthand', 'answer-terse', 'mystery-kind'],
    })
    assert({
      given: 'a memory with frontmatter kind and summary',
      should: 'parse them and strip frontmatter from the body',
      actual: {
        kind: memories[1].kind,
        summary: memories[1].summary,
        body: memories[1].body,
        freshness: memories[1].freshness,
      },
      expected: {
        kind: 'preference',
        summary: 'Terse answers',
        body: 'Keep answers terse.',
        freshness: '2026-01-10',
      },
    })
    assert({
      given: 'an unknown kind and no summary',
      should: 'leave kind undefined and fall back to the first body line',
      actual: { kind: memories[2].kind, summary: memories[2].summary },
      expected: { kind: undefined, summary: 'A kind this version does not know.' },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadMemories - missing dir is an empty store', async () => {
  assert({
    given: 'a memory dir that does not exist',
    should: 'return no memories instead of throwing',
    actual: await loadMemories(path.join(os.tmpdir(), 'memory-test-does-not-exist')),
    expected: [],
  })
})

test('renderPreferenceBlock - preference bodies only, one bullet each', async () => {
  const dir = await memoryDirWith({
    'answer-terse.md': memoryFile({
      kind: 'preference',
      lastConfirmed: '2026-01-10',
      body: 'Keep answers terse.\nOne idea per sentence.',
    }),
    'metric-units.md': memoryFile({
      kind: 'preference',
      lastConfirmed: '2026-02-01',
      body: 'Use metric units.',
    }),
    'atlas-shorthand.md': memoryFile({
      kind: 'glossary',
      lastConfirmed: '2026-03-01',
      body: 'Glossary entries stay out of the standing block.',
    }),
  })
  try {
    assert({
      given: 'two preferences (multi-line and single-line) and a glossary memory',
      should: 'render freshest-first single-line bullets from preferences alone',
      actual: renderPreferenceBlock(await loadMemories(dir)),
      expected: '- Use metric units.\n- Keep answers terse. One idea per sentence.',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('renderPreferenceBlock - empty without preferences, capped by tokens', async () => {
  assert({
    given: 'no memories',
    should: 'render an empty block',
    actual: renderPreferenceBlock([]),
    expected: '',
  })

  const oversized = 'All work and no play makes Jane a dull girl. '.repeat(400)
  const dir = await memoryDirWith({
    'first.md': memoryFile({ kind: 'preference', lastConfirmed: '2026-02-01', body: oversized }),
    'second.md': memoryFile({ kind: 'preference', lastConfirmed: '2026-01-01', body: 'Use metric units.' }),
  })
  try {
    const block = renderPreferenceBlock(await loadMemories(dir))
    assert({
      given: `a first preference alone exceeding the ${MEMORY_BLOCK.maxTokens}-token cap`,
      should: 'stop at the cap instead of appending later preferences out of order',
      actual: block,
      expected: '',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
