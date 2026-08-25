import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { loadMemories } from './mod.ts'
import { applyMemoryOps, MAX_OPS_PER_SAVE, type MemoryOp, sanitizeSlug } from './write.ts'

const TODAY = '2026-03-10'
const SOURCE = 'time/2026/03/09-15/03-10/actions/ai-chats/09-30_Atlas-Launch-Planning.md'

async function tmpMemoryDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'memory-write-'))
}

async function apply(memoryDir: string, ops: MemoryOp[]) {
  return applyMemoryOps({ memoryDir, ops, today: TODAY, source: SOURCE })
}

const existingFile = (fields: { locked?: boolean; uses?: number } = {}) =>
  [
    '---',
    'created: 2026-01-05',
    'updated: 2026-01-06',
    'kind: glossary',
    'summary: The big deck means the Atlas overview deck',
    'source: hand-seeded',
    'lastConfirmed: 2026-01-07',
    `uses: ${fields.uses ?? 2}`,
    ...(fields.locked ? ['locked: true'] : []),
    '---',
    '',
    'When Jane says "the big deck" she means the Atlas overview deck.',
    '',
  ].join('\n')

test('sanitizeSlug - kebab-cases and bounds model-proposed slugs', () => {
  assert({
    given: 'slugs with case, spaces, punctuation, and emptiness',
    should: 'kebab-case them and reduce garbage to empty',
    actual: [sanitizeSlug('Deck Shorthand!'), sanitizeSlug('--a--b--'), sanitizeSlug('???')],
    expected: ['deck-shorthand', 'a-b', ''],
  })
})

test('applyMemoryOps - create writes a full memory file into an empty store', async () => {
  const dir = await tmpMemoryDir()
  try {
    const outcomes = await apply(dir, [
      {
        op: 'create',
        kind: 'preference',
        slug: 'Metric Units',
        summary: 'Use metric units',
        body: 'Use metric units in answers.',
      },
    ])
    assert({
      given: 'a create op against an empty store',
      should: 'report it applied under the sanitized slug',
      actual: outcomes,
      expected: [
        { op: 'create', slug: 'metric-units', kind: 'preference', summary: 'Use metric units', outcome: 'applied' },
      ],
    })
    assert({
      given: 'the written file',
      should: 'carry the full frontmatter and body, loadable by the read side',
      actual: await readTextFile(path.join(dir, 'metric-units.md')),
      expected: [
        '---',
        `created: ${TODAY}`,
        `updated: ${TODAY}`,
        'kind: preference',
        'summary: Use metric units',
        `source: ${SOURCE}`,
        `lastConfirmed: ${TODAY}`,
        'uses: 0',
        '---',
        '',
        'Use metric units in answers.',
        '',
      ].join('\n'),
    })
    const loaded = await loadMemories(dir)
    assert({
      given: 'the store re-read through loadMemories',
      should: 'round-trip the new memory',
      actual: { kind: loaded[0].kind, summary: loaded[0].summary, freshness: loaded[0].freshness },
      expected: { kind: 'preference', summary: 'Use metric units', freshness: TODAY },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyMemoryOps - create on an existing slug refines it in place as an update', async () => {
  const dir = await tmpMemoryDir()
  try {
    await writeFile(path.join(dir, 'deck-shorthand.md'), existingFile())
    const outcomes = await apply(dir, [
      {
        op: 'create',
        kind: 'glossary',
        slug: 'deck-shorthand',
        summary: 'Deck shorthand',
        body: 'The big deck now means the Q2 overview deck.',
      },
    ])
    const written = await readTextFile(path.join(dir, 'deck-shorthand.md'))
    assert({
      given: 'a create op whose slug already exists',
      should: 'apply as an update, preserving created and uses',
      actual: {
        op: outcomes[0].op,
        outcome: outcomes[0].outcome,
        created: written.includes('created: 2026-01-05'),
        uses: written.includes('uses: 2'),
        body: written.includes('Q2 overview deck'),
      },
      expected: { op: 'update', outcome: 'applied', created: true, uses: true, body: true },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyMemoryOps - confirm bumps lastConfirmed and uses, leaving content alone', async () => {
  const dir = await tmpMemoryDir()
  try {
    await writeFile(path.join(dir, 'deck-shorthand.md'), existingFile({ uses: 2 }))
    const outcomes = await apply(dir, [{ op: 'confirm', slug: 'deck-shorthand' }])
    const written = await readTextFile(path.join(dir, 'deck-shorthand.md'))
    assert({
      given: 'a confirm op on an existing memory',
      should: 'bump uses and lastConfirmed, keep created/updated/body',
      actual: {
        outcome: outcomes[0],
        created: written.includes('created: 2026-01-05'),
        updated: written.includes('updated: 2026-01-06'),
        lastConfirmed: written.includes(`lastConfirmed: ${TODAY}`),
        uses: written.includes('uses: 3'),
        body: written.includes('she means the Atlas overview deck'),
      },
      expected: {
        outcome: {
          op: 'confirm',
          slug: 'deck-shorthand',
          kind: 'glossary',
          summary: 'The big deck means the Atlas overview deck',
          outcome: 'applied',
          uses: 3,
        },
        created: true,
        updated: true,
        lastConfirmed: true,
        uses: true,
        body: true,
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyMemoryOps - update rewrites content and moves source to the correcting chat', async () => {
  const dir = await tmpMemoryDir()
  try {
    await writeFile(path.join(dir, 'deck-shorthand.md'), existingFile())
    const outcomes = await apply(dir, [
      { op: 'update', slug: 'deck-shorthand', body: 'The big deck now means the Q2 board deck.' },
    ])
    const written = await readTextFile(path.join(dir, 'deck-shorthand.md'))
    assert({
      given: 'an update op with a new body and no summary',
      should: 'rewrite the body, keep the old summary, and re-source it',
      actual: {
        outcome: outcomes[0].outcome,
        summary: outcomes[0].summary,
        body: written.includes('Q2 board deck'),
        source: written.includes(`source: ${SOURCE}`),
        updated: written.includes(`updated: ${TODAY}`),
      },
      expected: {
        outcome: 'applied',
        summary: 'The big deck means the Atlas overview deck',
        body: true,
        source: true,
        updated: true,
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyMemoryOps - delete removes the file', async () => {
  const dir = await tmpMemoryDir()
  try {
    await writeFile(path.join(dir, 'deck-shorthand.md'), existingFile())
    const outcomes = await apply(dir, [{ op: 'delete', slug: 'deck-shorthand', reason: 'deck retired' }])
    assert({
      given: 'a delete op on an existing memory',
      should: 'remove the file and say why in the gist',
      actual: {
        outcome: outcomes[0].outcome,
        summary: outcomes[0].summary,
        gone: !(await exists(path.join(dir, 'deck-shorthand.md'))),
      },
      expected: {
        outcome: 'applied',
        summary: 'The big deck means the Atlas overview deck — deck retired',
        gone: true,
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyMemoryOps - locked memories refuse every mutation', async () => {
  const dir = await tmpMemoryDir()
  try {
    await writeFile(path.join(dir, 'deck-shorthand.md'), existingFile({ locked: true }))
    const before = await readTextFile(path.join(dir, 'deck-shorthand.md'))
    const outcomes = await apply(dir, [
      { op: 'update', slug: 'deck-shorthand', body: 'Rewritten.' },
      { op: 'confirm', slug: 'deck-shorthand' },
      { op: 'delete', slug: 'deck-shorthand', reason: 'stale' },
      { op: 'create', kind: 'glossary', slug: 'deck-shorthand', summary: 'x', body: 'y' },
    ])
    assert({
      given: 'update/confirm/delete/create ops against a locked memory',
      should: 'skip them all and leave the file byte-identical',
      actual: {
        outcomes: outcomes.map((o) => ({ outcome: o.outcome, reason: o.reason })),
        file: await readTextFile(path.join(dir, 'deck-shorthand.md')),
      },
      expected: {
        outcomes: [
          { outcome: 'skipped', reason: 'locked' },
          { outcome: 'skipped', reason: 'locked' },
          { outcome: 'skipped', reason: 'locked' },
          { outcome: 'skipped', reason: 'locked' },
        ],
        file: before,
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyMemoryOps - missing targets, invalid slugs, empty bodies, and proposals', async () => {
  const dir = await tmpMemoryDir()
  try {
    const outcomes = await apply(dir, [
      { op: 'confirm', slug: 'never-written' },
      { op: 'update', slug: 'never-written', body: 'x' },
      { op: 'delete', slug: 'never-written', reason: 'x' },
      { op: 'create', kind: 'thread', slug: '???', summary: 'x', body: 'y' },
      { op: 'create', kind: 'thread', slug: 'empty-body', summary: 'x', body: '   ' },
      { op: 'propose', flow: 'decision', gist: 'Atlas launch date is settled' },
    ])
    assert({
      given: 'ops that cannot land plus a proposal',
      should: 'skip the unusable ones with reasons and surface the proposal',
      actual: outcomes.map((o) => ({ op: o.op, outcome: o.outcome, reason: o.reason, summary: o.summary })),
      expected: [
        { op: 'confirm', outcome: 'skipped', reason: 'no such memory', summary: 'never-written' },
        { op: 'update', outcome: 'skipped', reason: 'no such memory', summary: 'never-written' },
        { op: 'delete', outcome: 'skipped', reason: 'no such memory', summary: 'never-written' },
        { op: 'create', outcome: 'skipped', reason: 'invalid slug', summary: 'x' },
        { op: 'create', outcome: 'skipped', reason: 'empty body', summary: 'x' },
        { op: 'propose', outcome: 'applied', reason: undefined, summary: 'Atlas launch date is settled → decision' },
      ],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyMemoryOps - ops beyond the per-save cap are skipped visibly', async () => {
  const dir = await tmpMemoryDir()
  try {
    const ops: MemoryOp[] = Array.from({ length: MAX_OPS_PER_SAVE + 2 }, (_, i) => ({
      op: 'create' as const,
      kind: 'thread' as const,
      slug: `runaway-${i}`,
      summary: `Runaway ${i}`,
      body: `Body ${i}.`,
    }))
    const outcomes = await apply(dir, ops)
    assert({
      given: `${MAX_OPS_PER_SAVE + 2} ops in one save`,
      should: `apply ${MAX_OPS_PER_SAVE} and skip the rest as capped`,
      actual: {
        applied: outcomes.filter((o) => o.outcome === 'applied').length,
        capped: outcomes.filter((o) => o.reason === 'per-save op cap').length,
      },
      expected: { applied: MAX_OPS_PER_SAVE, capped: 2 },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
