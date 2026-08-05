import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import VideoDocument from '#shared/models/Video/mod.ts'
import { assert, test } from '#test'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'fixtures')

test(`Video roundtrip`, async () => {
  const markdown = await readTextFile(path.join(DIR_FIXTURES, 'basic-video.md'))
  const video = VideoDocument.fromMarkdown(markdown)

  assert({
    given: 'fromMarkdown -> toMarkdown',
    should: 'produce identical markdown',
    expected: markdown,
    actual: video.toMarkdown(),
  })
})
