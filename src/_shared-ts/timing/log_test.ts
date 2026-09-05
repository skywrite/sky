import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { configureTiming } from './log.ts'
import { setTimingSink, withTiming } from './mod.ts'
import { parseTimingLog } from './read.ts'

test('timing writes durable metadata and reads completed spans back', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-timing-test-'))
  try {
    configureTiming({ dir, source: 'cli' })
    await withTiming({ kind: 'command', name: 'mock:lookup' }, async () => {
      return { success: true, document: 'Synthetic payload that must not be recorded' }
    })
    const files = await readdir(dir)
    const raw = (await Promise.all(files.map((file) => readFile(path.join(dir, file), 'utf8')))).join('\n')
    const records = parseTimingLog(raw)
    assert({
      given: 'a completed command with a document in its result',
      should: 'save start and end measurements without the document',
      actual: {
        files: files.length,
        records: records.length,
        outcome: records[0]?.outcome,
        measured: typeof records[0]?.durationMs === 'number',
        source: JSON.parse(raw.split('\n')[0]!).source,
        version: JSON.parse(raw.split('\n')[0]!).version,
        leaked: raw.includes('Synthetic payload'),
      },
      expected: { files: 1, records: 1, outcome: 'success', measured: true, source: 'cli', version: 1, leaked: false },
    })
  } finally {
    setTimingSink(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})
