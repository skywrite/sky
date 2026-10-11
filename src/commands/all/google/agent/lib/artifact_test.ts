import { afterAll } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import {
  artifactMedium,
  buildDocArtifact,
  docArtifactFileName,
  withReadTarget,
  writeMissionRecords,
} from './artifact.ts'
import type { MissionRecordInput } from './artifact.ts'
import type { MissionFile } from './tools.ts'

test('docArtifactFileName', () => {
  assert({
    given: 'a mission time and doc title',
    should: 'produce a chronological actions/google-docs path',
    expected: 'actions/google-docs/09-15_gdoc_Atlas-Q3-Plan.md',
    actual: docArtifactFileName('09:15', 'Atlas Q3 Plan'),
  })

  assert({
    given: 'a slides mission',
    should: 'tag the medium as gslides',
    expected: 'actions/google-docs/14-05_gslides_Atlas-Pitch.md',
    actual: docArtifactFileName('14:05', 'Atlas Pitch', artifactMedium('slides')),
  })
})

test('buildDocArtifact', () => {
  const artifact = buildDocArtifact({
    date: '2026-07-29',
    time: '09:15',
    account: 'jane@example.com',
    mission: 'Create the Atlas Q3 plan doc',
    files: [
      { id: 'file-1', title: 'Atlas Q3 Plan', url: 'https://docs.google.com/document/d/file-1', action: 'created' },
    ],
    report: 'Created the doc with three sections.',
  })

  assert({
    given: 'a completed mission',
    should: 'record provenance: when, account, files, mission, report',
    expected: [true, true, true, true, true],
    actual: [
      artifact.includes('created: 2026-07-29 09:15'),
      artifact.includes('account: jane@example.com'),
      artifact.includes('https://docs.google.com/document/d/file-1'),
      artifact.includes('**Mission:** Create the Atlas Q3 plan doc'),
      artifact.includes('Created the doc with three sections.'),
    ],
  })

  assert({
    given: 'a created file',
    should: 'title the artifact after it',
    expected: true,
    actual: artifact.includes('# Atlas Q3 Plan'),
  })

  assert({
    given: 'a touched file',
    should: 'mirror it into rel as a quoted titled link',
    expected: true,
    actual: artifact.includes('rel:\n  - "[Atlas Q3 Plan](https://docs.google.com/document/d/file-1)"'),
  })
})

test('withReadTarget', () => {
  const edited: MissionFile = {
    id: 'file-1',
    title: 'Atlas Q3 Plan',
    url: 'https://docs.google.com/document/d/file-1',
    action: 'updated',
  }
  const read: MissionFile = {
    id: 'file-2',
    title: 'Atlas Revenue Model',
    url: 'https://docs.google.com/spreadsheets/d/file-2',
    action: 'read',
  }

  assert({
    given: 'a read-only target the mission never edited',
    should: 'append it after the touched files',
    expected: ['file-1', 'file-2'],
    actual: withReadTarget([edited], read).map((f) => f.id),
  })

  assert({
    given: 'a target the mission also edited',
    should: 'keep the touched entry only',
    expected: ['file-1'],
    actual: withReadTarget([edited], { ...read, id: 'file-1' }).map((f) => f.id),
  })

  assert({
    given: 'no target file',
    should: 'return the touched files unchanged',
    expected: ['file-1'],
    actual: withReadTarget([edited], undefined).map((f) => f.id),
  })
})

const directories: string[] = []
afterAll(async () => {
  await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function recordFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-google-record-test-'))
  directories.push(root)
  const input: MissionRecordInput = {
    runId: 'atlas-mission-1',
    account: 'jane@example.com',
    mission: 'Create Atlas Q3 Plan',
    files: [{ id: 'f1', title: 'Atlas Q3 Plan', url: 'https://example.com/atlas', kind: 'doc', action: 'created' }],
    report: 'Created the plan.',
    documents: [
      { fileId: 'f1', version: '42', capturedAt: '2026-07-29T09:15:00Z', markdown: '# Atlas\n\nComplete plan.\n' },
    ],
    agentModel: { provider: 'openai', model: 'test-model', profile: 'test-profile', effort: 'medium' },
    timing: {
      profile: 'test-profile',
      steps: 4,
      wallMs: 12_000,
      modelMs: 3000,
      toolMs: 8000,
      tools: { batch_update_doc: { count: 2, ms: 8000 } },
    },
  }
  return {
    input,
    now: { date: '2026-07-29', time: '09:15' },
    options: { timeDir: path.join(root, 'time'), stateDir: path.join(root, 'state') },
    root,
  }
}

test('mission records preserve readable content and store execution details in state', async () => {
  const f = await recordFixture()
  const result = await writeMissionRecords(f.now, f.input, f.options)
  const artifact = await readFile(result.artifact!, 'utf8')
  const diagnostics = JSON.parse(await readFile(result.diagnostics!, 'utf8'))
  assert({
    given: 'a mission with a verified document and timing data',
    should: 'keep complete markdown in the day record and diagnostics in the state directory',
    actual: [
      result.issues,
      artifact.includes(f.input.documents![0]!.markdown),
      /profile:|steps:|## Timing|batch_update_doc/.test(artifact),
      diagnostics.agentModel,
      diagnostics.timing,
      diagnostics.artifact === result.artifact,
      diagnostics.documents,
      result.diagnostics!.startsWith(f.options.stateDir),
    ],
    expected: [
      [],
      true,
      false,
      f.input.agentModel,
      f.input.timing,
      true,
      [{ fileId: 'f1', version: '42', capturedAt: '2026-07-29T09:15:00Z' }],
      true,
    ],
  })
})

test('a missing final read is explained without presenting the input draft as finished content', async () => {
  const f = await recordFixture()
  const artifact = buildDocArtifact({ ...f.input, ...f.now, documents: [] })
  assert({
    given: 'a document that was changed without a complete read-back',
    should: 'retain the report and document link and explain the missing copy',
    actual: [
      artifact.includes('Created the plan.'),
      artifact.includes('https://example.com/atlas'),
      artifact.includes('not captured after the last change'),
    ],
    expected: [true, true, true],
  })
})

test('notebook and diagnostic storage failures do not discard the other record', async () => {
  const f = await recordFixture()
  const blocked = path.join(f.root, 'blocked')
  await writeFile(blocked, 'occupied')
  const noDiagnostics = await writeMissionRecords(f.now, f.input, { ...f.options, stateDir: blocked })
  const noNotebook = await writeMissionRecords(f.now, f.input, { ...f.options, timeDir: blocked })
  assert({
    given: 'unwritable diagnostics and then an unwritable notebook',
    should: 'preserve the successful record and report exactly which write failed',
    actual: [
      (await readFile(noDiagnostics.artifact!, 'utf8')).includes('Complete plan.'),
      noDiagnostics.issues.length,
      noDiagnostics.issues[0]?.includes('mission diagnostics'),
      JSON.parse(await readFile(noNotebook.diagnostics!, 'utf8')).timing.steps,
      noNotebook.issues.length,
      noNotebook.issues[0]?.includes('notebook record'),
    ],
    expected: [true, 1, true, 4, 1, true],
  })
})

test('read-only missions retain diagnostics without adding an empty notebook record', async () => {
  const f = await recordFixture()
  const result = await writeMissionRecords(f.now, { ...f.input, files: [], documents: [] }, f.options)
  assert({
    given: 'a mission that only read files',
    should: 'save its timing while leaving the day folder alone',
    actual: [result.artifact, JSON.parse(await readFile(result.diagnostics!, 'utf8')).timing.steps, result.issues],
    expected: [undefined, 4, []],
  })
})
