import { assert, test } from '#test'
import { artifactRelEntries, recordExternalFiles } from './artifactRel.ts'

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/abc123/edit'
const DOC_URL = 'https://docs.google.com/document/d/def456/edit'

test('recordExternalFiles', () => {
  const collected = new Map<string, string>()
  recordExternalFiles(collected, [{ title: 'Atlas Revenue Model', url: SHEET_URL }])
  recordExternalFiles(collected, [
    { title: 'Atlas Revenue Model v2', url: SHEET_URL },
    { title: 'Atlas Q3 Plan', url: DOC_URL },
  ])

  assert({
    given: 'the same URL reported twice with a newer title, plus a second file',
    should: 'keep one entry per URL with the newest title',
    expected: [
      [SHEET_URL, 'Atlas Revenue Model v2'],
      [DOC_URL, 'Atlas Q3 Plan'],
    ],
    actual: Array.from(collected.entries()),
  })
})

test('artifactRelEntries', () => {
  const collected = new Map([
    [SHEET_URL, 'Atlas Revenue Model'],
    [DOC_URL, 'Atlas Q3 Plan'],
  ])

  assert({
    given: 'collected artifacts and no existing rel',
    should: 'render each as a titled markdown link',
    expected: [`[Atlas Revenue Model](${SHEET_URL})`, `[Atlas Q3 Plan](${DOC_URL})`],
    actual: artifactRelEntries(collected),
  })

  assert({
    given: 'an existing rel entry already carrying one URL (hand-written, bare)',
    should: 'skip that URL and keep the rest',
    expected: [`[Atlas Q3 Plan](${DOC_URL})`],
    actual: artifactRelEntries(collected, ['projects/Atlas-GTM', SHEET_URL]),
  })

  assert({
    given: 'an existing titled link for the same URL',
    should: 'skip it too — containment matches either shape',
    expected: [`[Atlas Q3 Plan](${DOC_URL})`],
    actual: artifactRelEntries(collected, [`[Old Title](${SHEET_URL})`]),
  })

  assert({
    given: 'nothing collected',
    should: 'return no entries',
    expected: [],
    actual: artifactRelEntries(new Map()),
  })
})
