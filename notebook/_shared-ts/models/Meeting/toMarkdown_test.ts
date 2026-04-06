import { assert, test } from '#test'
import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import MeetingDocument from '#shared/models/Meeting/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'fixtures')

test(`MeetingDocument.fromMarkdown() with fixture`, async () => {
  const given = 'Parse Meeting from fixture file'
  const should = 'restore yaml fields'

  const markdown = await readTextFile(path.join(DIR_FIXTURES, 'basic-meeting.md'))
  const m = MeetingDocument.fromMarkdown(markdown)

  assert({
    given,
    should,
    expected: 'Bob Smith',
    actual: m.who,
  })

  assert({
    given,
    should: 'parse when correctly',
    expected: '20:24',
    actual: m.when.time,
  })

  assert({
    given,
    should: 'parse medium correctly',
    expected: 'Zoom',
    actual: m.medium,
  })
})

test(`new MeetingDocument()`, () => {
  const given = 'Create Meeting w/ props'
  const should = 'have correct yaml fields'

  const when = new PlainDateTime(new Date(2022, 10, 17, 20, 24))
  const m = new MeetingDocument({ who: 'acme/daniel', when, medium: 'Zoom', summary: 'test summary' })

  assert({
    given,
    should,
    expected: 'acme/daniel',
    actual: m.who,
  })

  assert({
    given,
    should: 'have correct when time',
    expected: '20:24',
    actual: m.when.time,
  })

  assert({
    given,
    should: 'have correct medium',
    expected: 'Zoom',
    actual: m.medium,
  })

  assert({
    given,
    should: 'have correct summary',
    expected: 'test summary',
    actual: m.summary,
  })
})

test(`Meeting.toMarkdown()`, () => {
  const given = 'Create Meeting w/ props'
  const should = 'render markdown with yaml frontmatter'

  const when = new PlainDateTime(new Date(2022, 10, 17, 20, 24))
  const m = new MeetingDocument({ who: 'acme/daniel', when })
  const md = m.toMarkdown()

  assert({
    given,
    should,
    expected: true,
    actual: md.includes('---'),
  })

  assert({
    given,
    should: 'include who field',
    expected: true,
    actual: md.includes('who: acme/daniel'),
  })

  assert({
    given,
    should: 'include when field',
    expected: true,
    actual: md.includes('when: 20:24'),
  })

  assert({
    given,
    should: 'include medium field',
    expected: true,
    actual: md.includes('medium: Zoom'),
  })

  assert({
    given,
    should: 'include markdown heading',
    expected: true,
    actual: md.includes('# Meeting'),
  })

  assert({
    given,
    should: 'include Agenda Items section',
    expected: true,
    actual: md.includes('## Agenda Items'),
  })

  assert({
    given,
    should: 'include Outcomes section',
    expected: true,
    actual: md.includes('## Outcomes'),
  })
})

test(`MeetingDocument.fromMarkdown()`, () => {
  const given = 'Parse Meeting from markdown'
  const should = 'restore yaml fields'

  const markdown = `---
who: test/person
when: 14:30
medium: Phone
context: business
summary: quarterly review
---

# Meeting

## Notes
Some notes here.
`

  const m = MeetingDocument.fromMarkdown(markdown)

  assert({
    given,
    should,
    expected: 'test/person',
    actual: m.who,
  })

  assert({
    given,
    should: 'parse when correctly',
    expected: '14:30',
    actual: m.when.time,
  })

  assert({
    given,
    should: 'parse medium correctly',
    expected: 'Phone',
    actual: m.medium,
  })

  assert({
    given,
    should: 'parse context correctly',
    expected: 'business',
    actual: m.context,
  })

  assert({
    given,
    should: 'parse summary correctly',
    expected: 'quarterly review',
    actual: m.summary,
  })
})

test(`new MeetingDocument() defaults`, () => {
  const given = 'Create Meeting with minimal props'
  const should = 'use default medium'

  const m = new MeetingDocument({ who: 'test/person' })

  assert({
    given,
    should,
    expected: 'Zoom',
    actual: m.medium,
  })

  assert({
    given,
    should: 'have a default when time',
    expected: true,
    actual: m.when.time.length > 0,
  })
})

test(`new MeetingDocument() with In Person medium`, () => {
  const given = 'Create In Person Meeting'
  const should = 'add where field'

  const m = new MeetingDocument({ who: 'test/person', medium: 'In Person' })
  const md = m.toMarkdown()

  assert({
    given,
    should,
    expected: 'In Person',
    actual: m.medium,
  })

  assert({
    given,
    should: 'include where field in yaml',
    expected: true,
    actual: md.includes('where:'),
  })
})

test(`new MeetingDocument() with when as string`, () => {
  const given = 'Create Meeting with when as time string'
  const should = 'parse when correctly'

  const m = new MeetingDocument({ who: 'test/person', when: '15:30' })

  assert({
    given,
    should,
    expected: '15:30',
    actual: m.when.time,
  })
})
