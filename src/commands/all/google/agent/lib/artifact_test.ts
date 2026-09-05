import { assert, test } from '#test'
import { artifactMedium, buildDocArtifact, docArtifactFileName, withReadTarget } from './artifact.ts'
import type { MissionFile } from './tools.ts'

test('docArtifactFileName', () => {
  assert({
    given: 'a mission time and doc title',
    should: 'produce a chronological actions/docs path',
    expected: 'actions/docs/09-15_gdoc_Atlas-Q3-Plan.md',
    actual: docArtifactFileName('09:15', 'Atlas Q3 Plan'),
  })

  assert({
    given: 'a slides mission',
    should: 'tag the medium as gslides',
    expected: 'actions/docs/14-05_gslides_Atlas-Pitch.md',
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

test('buildDocArtifact carries the mission timing when given one', () => {
  const artifact = buildDocArtifact({
    date: '2026-07-29',
    time: '09:15',
    account: 'jane@example.com',
    mission: 'Create Atlas Q3 Plan',
    files: [{ id: 'f1', title: 'Atlas Q3 Plan', url: 'https://docs.google.com/document/d/f1/edit', action: 'created' }],
    report: 'Done.',
    timing: {
      profile: 'default-cerebras-qwen-3.8',
      steps: 4,
      wallMs: 12_000,
      modelMs: 3000,
      toolMs: 8000,
      tools: { batch_update_doc: { count: 2, ms: 8000 } },
    },
  })
  assert({
    given: 'a mission record with timing',
    should: 'name the profile and steps in front matter and carry the timing block after the report',
    actual: [
      artifact.includes('\nprofile: default-cerebras-qwen-3.8\nsteps: 4\n---'),
      artifact.includes(
        '## Timing\n\n- steps: 4\n- wall: 12s\n- model: 3.0s\n- tools: 8.0s\n  - batch_update_doc: 2× 8.0s',
      ),
    ],
    expected: [true, true],
  })
})
