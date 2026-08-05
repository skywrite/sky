import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import MessageDocument from './mod.ts'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'fixtures')

test(`MessageDocument.fromMarkdown() with fixture`, async () => {
  const given = 'Parse Message from fixture file'
  const should = 'restore yaml fields'

  const markdown = await readTextFile(path.join(DIR_FIXTURES, 'basic-message.md'))
  const m = MessageDocument.fromMarkdown(markdown)

  assert({
    given,
    should,
    expected: 'Alice',
    actual: m.from,
  })

  assert({
    given,
    should: 'parse to correctly',
    expected: 'Bob',
    actual: m.to,
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
    expected: 'Slack',
    actual: m.medium,
  })
})

test(`new MessageDocument()`, () => {
  const given = 'Create Message w/ props'
  const should = 'have correct yaml fields'

  const when = new PlainDateTime(new Date(2022, 10, 17, 14, 30))
  const m = new MessageDocument({
    from: 'Alice',
    to: 'Bob',
    when,
    medium: 'WhatsApp',
    summary: 'test summary',
  })

  assert({
    given,
    should,
    expected: 'Alice',
    actual: m.from,
  })

  assert({
    given,
    should: 'have correct to',
    expected: 'Bob',
    actual: m.to,
  })

  assert({
    given,
    should: 'have correct when time',
    expected: '14:30',
    actual: m.when.time,
  })

  assert({
    given,
    should: 'have correct medium',
    expected: 'WhatsApp',
    actual: m.medium,
  })

  assert({
    given,
    should: 'have correct summary',
    expected: 'test summary',
    actual: m.summary,
  })
})

test(`new MessageDocument() field order`, () => {
  const given = 'Create Message'
  const should = 'have from before to in yaml'

  const m = new MessageDocument({
    from: 'Alice',
    to: 'Bob',
    medium: 'Slack',
  })

  const md = m.toMarkdown()
  const fromIndex = md.indexOf('from:')
  const toIndex = md.indexOf('to:')

  assert({
    given,
    should,
    expected: true,
    actual: fromIndex < toIndex,
  })
})

test(`new MessageDocument() with only from`, () => {
  const given = 'Create Message with only from'
  const should = 'have null to'

  const m = new MessageDocument({
    from: 'Alice',
    medium: 'iMessage',
  })

  assert({
    given,
    should,
    expected: 'Alice',
    actual: m.from,
  })

  assert({
    given,
    should: 'have null to',
    expected: null,
    actual: m.yaml['to'],
  })
})

test(`new MessageDocument() with only to`, () => {
  const given = 'Create Message with only to'
  const should = 'have null from'

  const m = new MessageDocument({
    to: 'Bob',
    medium: 'SMS',
  })

  assert({
    given,
    should,
    expected: 'Bob',
    actual: m.to,
  })

  assert({
    given,
    should: 'have null from',
    expected: null,
    actual: m.yaml['from'],
  })
})
