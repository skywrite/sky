import { assert, test } from '#test'
import { readFileSync } from 'node:fs'
import DayDocument from './mod.ts'

// Load fixture from file
const FIXTURE_PATH = new URL('./fixtures/day-with-document-refs.md', import.meta.url).pathname
const DAY_WITH_REFS = readFileSync(FIXTURE_PATH, 'utf-8')

// --- meetingRefs tests ---

test('DayDocument.meetingRefs - extracts meetings from Complete sections', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)

  assert({
    given: 'a day with meeting links',
    should: 'return correct number of meetings',
    actual: day.meetingRefs.length,
    expected: 7,
  })
})

test('DayDocument.meetingRefs - extracts time, path, and title', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)
  const firstMeeting = day.meetingRefs[0]

  assert({
    given: 'first meeting ref',
    should: 'have correct time',
    actual: firstMeeting.time,
    expected: '11:05',
  })

  assert({
    given: 'first meeting ref',
    should: 'have correct path',
    actual: firstMeeting.path,
    expected: 'actions/meetings/Zoom_David-Chen_Product-Launch-Discussion.md',
  })

  assert({
    given: 'first meeting ref',
    should: 'have correct title',
    actual: firstMeeting.title,
    expected: 'Product Launch Discussion',
  })
})

test('DayDocument.meetingRefs - handles different meeting types (Zoom, In Person, FT Audio)', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)
  const paths = day.meetingRefs.map((r) => r.path)

  assert({
    given: 'meetings with various types',
    should: 'include Zoom meetings',
    actual: paths.some((p) => p.includes('Zoom_')),
    expected: true,
  })

  assert({
    given: 'meetings with various types',
    should: 'include In-Person meetings',
    actual: paths.some((p) => p.includes('In-Person_')),
    expected: true,
  })

  assert({
    given: 'meetings with various types',
    should: 'include FT-Audio meetings',
    actual: paths.some((p) => p.includes('FT-Audio_')),
    expected: true,
  })
})

// --- messageRefs tests ---

test('DayDocument.messageRefs - extracts messages from Complete sections', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)

  assert({
    given: 'a day with message links',
    should: 'return correct number of messages',
    actual: day.messageRefs.length,
    expected: 1,
  })
})

test('DayDocument.messageRefs - extracts email message correctly', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)
  const message = day.messageRefs[0]

  assert({
    given: 'email message ref',
    should: 'have correct time',
    actual: message.time,
    expected: '09:42',
  })

  assert({
    given: 'email message ref',
    should: 'have correct path',
    actual: message.path,
    expected: 'actions/messages/email_Alice-to-Bob_Partnership-Proposal.md',
  })

  assert({
    given: 'email message ref',
    should: 'have correct title',
    actual: message.title,
    expected: 're: Partnership Proposal',
  })
})

// --- noteRefs tests ---

test('DayDocument.noteRefs - extracts notes from Complete sections', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)

  assert({
    given: 'a day with note links',
    should: 'return correct number of notes',
    actual: day.noteRefs.length,
    expected: 3,
  })
})

test('DayDocument.noteRefs - extracts notes from both Professional and Personal Complete', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)
  const titles = day.noteRefs.map((r) => r.title)

  assert({
    given: 'notes from multiple Complete sections',
    should: 'include Professional Complete notes',
    actual: titles.includes('Interview Prep Notes'),
    expected: true,
  })

  assert({
    given: 'notes from multiple Complete sections',
    should: 'include Personal Complete notes',
    actual: titles.includes('Book Notes: Leadership'),
    expected: true,
  })
})

// --- projectRefs tests ---

test('DayDocument.projectRefs - extracts projects from Complete sections', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)

  assert({
    given: 'a day with project references',
    should: 'return correct number of projects',
    actual: day.projectRefs.length,
    expected: 2,
  })
})

test('DayDocument.projectRefs - extracts project path and description', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)
  const firstProject = day.projectRefs[0]

  assert({
    given: 'first project ref',
    should: 'have correct time',
    actual: firstProject.time,
    expected: '09:52',
  })

  assert({
    given: 'first project ref',
    should: 'have correct path',
    actual: firstProject.path,
    expected: 'projects/Alpha-Project',
  })

  assert({
    given: 'first project ref',
    should: 'have correct title (description)',
    actual: firstProject.title,
    expected: 'Created new feature for user authentication',
  })
})

test('DayDocument.projectRefs - handles multiple projects', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)
  const paths = day.projectRefs.map((r) => r.path)

  assert({
    given: 'multiple project refs',
    should: 'include Alpha-Project',
    actual: paths.includes('projects/Alpha-Project'),
    expected: true,
  })

  assert({
    given: 'multiple project refs',
    should: 'include Beta-Platform',
    actual: paths.includes('projects/Beta-Platform'),
    expected: true,
  })
})

// --- decisionRefs tests ---

test('DayDocument.decisionRefs - extracts decisions from Complete sections', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)

  assert({
    given: 'a day with decision references',
    should: 'return correct number of decisions',
    actual: day.decisionRefs.length,
    expected: 2,
  })
})

test('DayDocument.decisionRefs - extracts decision path and description', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)
  const firstDecision = day.decisionRefs[0]

  assert({
    given: 'first decision ref',
    should: 'have correct time',
    actual: firstDecision.time,
    expected: '09:30',
  })

  assert({
    given: 'first decision ref',
    should: 'have correct path',
    actual: firstDecision.path,
    expected: 'decisions/Hire-Senior-Engineer',
  })

  assert({
    given: 'first decision ref',
    should: 'have correct title (status + description)',
    actual: firstDecision.title,
    expected: 'Identified | Should we hire a senior engineer for Q2?',
  })
})

test('DayDocument.decisionRefs - handles multiple decisions', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)
  const paths = day.decisionRefs.map((r) => r.path)

  assert({
    given: 'multiple decision refs',
    should: 'include Hire-Senior-Engineer',
    actual: paths.includes('decisions/Hire-Senior-Engineer'),
    expected: true,
  })

  assert({
    given: 'multiple decision refs',
    should: 'include Office-Relocation',
    actual: paths.includes('decisions/Office-Relocation'),
    expected: true,
  })
})

test('DayDocument.decisionRefs - returns empty array when no decisions', () => {
  const day = DayDocument.fromMarkdown(`---
started: 06:00
---

# **2026-01-01 - Wed**

## Professional Complete
- 08:00 > ~~Simple task without decision~~
`)

  assert({
    given: 'a day with no decision refs',
    should: 'return empty array',
    actual: day.decisionRefs,
    expected: [],
  })
})

// --- allDocumentRefs tests ---

test('DayDocument.allDocumentRefs - combines all ref types', () => {
  const day = DayDocument.fromMarkdown(DAY_WITH_REFS)

  const expectedTotal =
    day.meetingRefs.length +
    day.messageRefs.length +
    day.noteRefs.length +
    day.projectRefs.length +
    day.decisionRefs.length

  assert({
    given: 'a day with all ref types',
    should: 'return combined count',
    actual: day.allDocumentRefs.length,
    expected: expectedTotal,
  })

  assert({
    given: 'a day with all ref types',
    should: 'have correct total (7 meetings + 1 message + 3 notes + 2 projects + 2 decisions)',
    actual: day.allDocumentRefs.length,
    expected: 15,
  })
})

// --- Edge cases ---

test('DayDocument.meetingRefs - returns empty array when no meetings', () => {
  const day = DayDocument.fromMarkdown(`---
started: 06:00
---

# **2026-01-01 - Wed**

## Professional Complete
- 08:00 > ~~Simple task without link~~
`)

  assert({
    given: 'a day with no meeting links',
    should: 'return empty array',
    actual: day.meetingRefs,
    expected: [],
  })
})

test('DayDocument.projectRefs - returns empty array when no projects', () => {
  const day = DayDocument.fromMarkdown(`---
started: 06:00
---

# **2026-01-01 - Wed**

## Professional Complete
- 08:00 > ~~Simple task without project~~
`)

  assert({
    given: 'a day with no project refs',
    should: 'return empty array',
    actual: day.projectRefs,
    expected: [],
  })
})

test('DayDocument refs - ignores non-Complete sections', () => {
  const day = DayDocument.fromMarkdown(`---
started: 06:00
---

# **2026-01-01 - Wed**

## Professional Todos
- 10:00 > Meeting -> [Should Not Match](actions/meetings/Ignored.md)

## Professional Complete
- 11:00 > Real Meeting -> [Should Match](actions/meetings/Real.md)
`)

  assert({
    given: 'links in non-Complete sections',
    should: 'only extract from Complete sections',
    actual: day.meetingRefs.length,
    expected: 1,
  })

  assert({
    given: 'links in non-Complete sections',
    should: 'extract the correct meeting',
    actual: day.meetingRefs[0].title,
    expected: 'Should Match',
  })
})
