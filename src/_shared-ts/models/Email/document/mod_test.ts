import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import EmailDocument from './mod.ts'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'fixtures')

test(`EmailDocument.fromMarkdown() with fixture`, async () => {
  const given = 'Parse Email from fixture file'
  const should = 'restore yaml fields'

  const markdown = await readTextFile(path.join(DIR_FIXTURES, 'basic-email.md'))
  const e = EmailDocument.fromMarkdown(markdown)

  assert({
    given,
    should,
    expected: 'alice@example.com',
    actual: e.from,
  })

  assert({
    given,
    should: 'parse to correctly',
    expected: 'bob@example.com',
    actual: e.to,
  })

  assert({
    given,
    should: 'parse when correctly',
    expected: '09:15',
    actual: e.when.datetime.time,
  })
})

test(`new EmailDocument()`, () => {
  const given = 'Create Email w/ props'
  const should = 'have correct yaml fields'

  const when = new PlainDateTime(new Date(2022, 10, 17, 9, 15))
  const e = new EmailDocument({
    from: 'alice@example.com',
    to: 'bob@example.com',
    cc: 'carol@example.com',
    bcc: 'dave@example.com',
    when,
    subject: 'Test Subject',
    summary: 'test summary',
  })

  assert({
    given,
    should,
    expected: 'alice@example.com',
    actual: e.from,
  })

  assert({
    given,
    should: 'have correct to',
    expected: 'bob@example.com',
    actual: e.to,
  })

  assert({
    given,
    should: 'have correct cc',
    expected: 'carol@example.com',
    actual: e.cc,
  })

  assert({
    given,
    should: 'have correct bcc',
    expected: 'dave@example.com',
    actual: e.bcc,
  })

  assert({
    given,
    should: 'have correct when time',
    expected: '09:15',
    actual: e.when.datetime.time,
  })

  assert({
    given,
    should: 'have correct subject',
    expected: 'Test Subject',
    actual: e.subject,
  })

  assert({
    given,
    should: 'have correct summary',
    expected: 'test summary',
    actual: e.summary,
  })
})

test(`new EmailDocument() field order`, () => {
  const given = 'Create Email'
  const should = 'have correct field order in yaml'

  const e = new EmailDocument({
    from: 'alice@example.com',
    to: 'bob@example.com',
    cc: 'carol@example.com',
  })

  const md = e.toMarkdown()
  const fromIndex = md.indexOf('from:')
  const toIndex = md.indexOf('to:')
  const ccIndex = md.indexOf('cc:')
  const whenIndex = md.indexOf('when:')

  assert({
    given,
    should: 'have from before to',
    expected: true,
    actual: fromIndex < toIndex,
  })

  assert({
    given,
    should: 'have to before cc',
    expected: true,
    actual: toIndex < ccIndex,
  })

  assert({
    given,
    should: 'have cc before when',
    expected: true,
    actual: ccIndex < whenIndex,
  })
})

test(`Email inherits from Message`, () => {
  const given = 'Email instance'
  const should = 'have Message getters'

  const e = new EmailDocument({
    from: 'alice@example.com',
    to: 'bob@example.com',
    summary: 'test',
  })

  // These come from Message
  assert({
    given,
    should: 'have from getter',
    expected: 'alice@example.com',
    actual: e.from,
  })

  assert({
    given,
    should: 'have summary getter',
    expected: 'test',
    actual: e.summary,
  })
})
