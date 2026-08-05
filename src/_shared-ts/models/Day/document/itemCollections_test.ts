import * as path from 'node:path'
import readTextFileSync from '#shared/fs/readTextFileSync.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'markdown', '_fixtures')
const FIXTURE_MARKDOWN = readTextFileSync(path.join(DIR_FIXTURES, 'day-standard-empty-items.md'))

test(`${DayDocument.name}.addDayItems()`, () => {
  const day = DayDocument.fromMarkdown(FIXTURE_MARKDOWN)

  assert({
    expected: ['Personal Commitments', 'Personal Complete', 'Professional Commitments', 'Professional Complete'],
    actual: day.lists.map((dic) => dic.title),
  })
})
