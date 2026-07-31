import { assert, test } from '#test'
import { artifactMedium, buildDocArtifact, docArtifactFileName } from './artifact.ts'

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
})
