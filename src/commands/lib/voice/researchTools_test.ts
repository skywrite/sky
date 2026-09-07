import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assert, test } from '#test'
import { createVoiceResearchTools, type ResearchTrace } from './researchTools.ts'

function trace(): ResearchTrace {
  return { paths: new Set(), searches: 0, failures: 0, bytes: 0, calls: 0 }
}
const EXECUTION = { toolCallId: 'read-test', messages: [], context: {} }
type ReadResult = { ok: boolean; markdown?: string; nextOffsetBytes?: number; error?: string }

test('voice research reads preserve UTF-8 text and source byte offsets across chunk boundaries', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'voice-utf8-test-'))
  try {
    const text = 'aaaébb€cc🧭dd'
    await writeFile(path.join(base, 'unicode.md'), text)
    const state = trace()
    const tools = createVoiceResearchTools({
      baseDir: base,
      port: 1,
      signal: new AbortController().signal,
      trace: state,
      maxCalls: 10,
      maxBytes: 100,
      chunkBytes: 4,
    })
    const chunks: string[] = []
    const offsets: number[] = []
    let offsetBytes: number | undefined = 0
    while (offsetBytes !== undefined) {
      offsets.push(offsetBytes)
      const result = (await tools.read_file.execute!({ path: 'unicode.md', offsetBytes }, EXECUTION)) as ReadResult
      if (!result.ok) throw new Error(result.error)
      chunks.push(result.markdown!)
      offsetBytes = result.nextOffsetBytes
    }
    assert({
      given: 'two-, three-, and four-byte characters crossing a four-byte chunk boundary',
      should: 'return complete characters and offsets into the original bytes',
      actual: [chunks.join(''), offsets, [...state.paths]],
      expected: [text, [0, 3, 7, 11, 12, 16], ['unicode.md']],
    })
    assert({
      given: 'overlap needed to preserve a split character',
      should: 'count bytes actually read, including overlap, against the budget',
      actual: state.bytes,
      expected: 22,
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('voice research releases reserved bytes when a candidate cannot be read as a file', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'voice-read-budget-test-'))
  try {
    await mkdir(path.join(base, 'directory.md'))
    await writeFile(path.join(base, 'valid.md'), 'hello')
    const state = trace()
    const tools = createVoiceResearchTools({
      baseDir: base,
      port: 1,
      signal: new AbortController().signal,
      trace: state,
      maxCalls: 3,
      maxBytes: 5,
      chunkBytes: 5,
    })
    const rejected = (await tools.read_file.execute!({ path: 'directory.md' }, EXECUTION)) as ReadResult
    const afterFailure = state.bytes
    const valid = (await tools.read_file.execute!({ path: 'valid.md' }, EXECUTION)) as ReadResult
    assert({
      given: 'a candidate rejected after its read budget was reserved',
      should: 'leave that budget available for a readable source',
      actual: [rejected.ok, afterFailure, valid.markdown, state.bytes, [...state.paths]],
      expected: [false, 0, 'hello', 5, ['valid.md']],
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
