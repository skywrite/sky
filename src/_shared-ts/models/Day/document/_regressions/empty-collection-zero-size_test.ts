import { assert, test } from '#test'
import * as path from 'node:path'
import readTextFile from '#shared/fs/readTextFile.ts'
import DayDocument from '#shared/models/Day/mod.ts'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, '..', 'markdown', '_fixtures')
const FILE_EMPTY_MARKDOWN = path.join(DIR_FIXTURES, 'day-standard-empty-items.md')

test(`${DayDocument.name}: empty collections`, async () => {
  const emptyItemsMarkdown = await readTextFile(FILE_EMPTY_MARKDOWN)
  const dayEmptyItems = DayDocument.fromMarkdown(emptyItemsMarkdown)

  assert({
    given: 'has empty collections',
    should: 'should return 0 size',
    expected: 0,
    actual: dayEmptyItems.lists.reduce((sum, dic) => {
      return dic.size + sum
    }, 0),
  })
})
