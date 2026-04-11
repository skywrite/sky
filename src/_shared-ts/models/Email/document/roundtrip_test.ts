import { assert, test } from '#test'
import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import EmailDocument from './mod.ts'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'fixtures')

test(`Email roundtrip`, async () => {
  const markdown = await readTextFile(path.join(DIR_FIXTURES, 'basic-email.md'))
  const email = EmailDocument.fromMarkdown(markdown)

  assert({
    given: 'fromMarkdown -> toMarkdown',
    should: 'produce identical markdown',
    expected: markdown,
    actual: email.toMarkdown(),
  })
})
