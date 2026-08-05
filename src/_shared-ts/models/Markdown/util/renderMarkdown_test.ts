import * as path from 'node:path'
// import marked from 'marked'
import * as marked from 'marked'
// import { DIR_NOTES, DIR_PEOPLE, DIR_PLACES, DIR_THINGS, DIR_TIME } from '#config'
import { DIRS_MARKDOWN } from '#config'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import renderMarkdown from './renderMarkdown.ts'

// TODO: make more
// const FIXTURE_FILE = path.join(DIR_TIME, '2022', '09', '05-11', '07', '_day.md')

// does not include DIR_PROJECTS as there is the markdown for IA Presenter
// does not get parsed properly by Marked
// I've learned that Marked loses some fidelity when parsing
// const DIRS_TEST = [DIR_NOTES, DIR_PEOPLE, DIR_PLACES, DIR_THINGS, DIR_TIME]
// const DIRS_TEST = [DIR_TIME + '/2024/07/01-07/01/']
const DIRS_TEST = DIRS_MARKDOWN

// Round-trips every .md file in the real notebook — minutes of work, far
// past bun's 5s default timeout (it was silently timing out for months).
test(renderMarkdown.name, { timeout: 300_000 }, async () => {
  for (const dir of DIRS_TEST) {
    for await (const entry of walk(dir)) {
      if (path.extname(entry.path) !== '.md') continue
      // console.log(entry.path)

      const contents = await readTextFile(entry.path)

      const tokens = marked.lexer(contents, {})
      // console.dir(tokens, { depth: null })

      assert({
        given: `markdown tokens from ${entry.path}`,
        should: 'render markdown',
        actual: renderMarkdown(tokens),
        expected: contents,
      })
    }
  }
})
