import { assert, test } from '#test'
import * as path from 'node:path'
import { readDir, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, '_fixtures')

for await (const dirEntry of readDir(DIR_FIXTURES)) {
  if (dirEntry.isFile) {
    const file = path.join(DIR_FIXTURES, dirEntry.name)
    test(`${DayDocument.name} markdown roundtrip: ${dirEntry.name}`, async () => {
      const expected = await readTextFile(file)
      const actual = DayDocument.fromMarkdown(expected).toMarkdown()

      /*
      if (dirEntry.name === 'day-with-links.md') {
        await writeTextFile('/tmp/' + dirEntry.name, actual)
      }
      */

      assert({
        given: `Markdown from ${dirEntry.name}`,
        should: 'rountrip convert into Day()',
        expected,
        actual,
      })
    })
  }
}
