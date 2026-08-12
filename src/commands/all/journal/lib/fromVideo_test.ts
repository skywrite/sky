import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { disarmTranscriptHeadings, nextJournalPrefix, splitTitle, stripCodeFence } from './fromVideo.ts'

test(`disarmTranscriptHeadings() with a plain heading`, () => {
  const given = 'headings that say nothing about transcripts'
  const should = 'leave the markdown untouched'

  const md = '## The Atlas launch date\nI keep going back and forth.\n\n## Hiring\nStill behind.'
  assert({ given, should, actual: disarmTranscriptHeadings(md).markdown, expected: md })
})

test(`disarmTranscriptHeadings() with an exact Transcript heading`, () => {
  const given = 'the heading a model most likely reaches for'
  const should = 'rename it so the body is not dropped downstream'

  const { markdown, renamed } = disarmTranscriptHeadings('## Transcript\nWhat I said.')
  assert({ given, should, actual: markdown, expected: '## What was said\nWhat I said.' })
  assert({ given, should: 'report one rename', actual: renamed, expected: 1 })
})

test(`disarmTranscriptHeadings() with the word embedded in a longer heading`, () => {
  const given: string = 'a heading that merely contains the word'
  const should = 'strip the word and keep the rest, since matching is by substring'

  const { markdown } = disarmTranscriptHeadings('### Raw transcript of the call\nbody')
  assert({ given, should, actual: markdown, expected: '### Raw of the call\nbody' })
})

test(`disarmTranscriptHeadings() with mixed casing and a plural`, () => {
  const given = 'casing and pluralisation the downstream filter still matches'
  const should = 'rename those headings too'

  const { renamed } = disarmTranscriptHeadings('## TRANSCRIPT\na\n\n## Meeting Transcripts\nb')
  assert({ given, should, actual: renamed, expected: 2 })
})

test(`disarmTranscriptHeadings() with the word in body text`, () => {
  const given = 'the word appearing in prose rather than a heading'
  const should = 'leave it alone, because only headings drive the filter'

  const md = '## Recording setup\nI mention the transcript here on purpose.'
  assert({ given, should, actual: disarmTranscriptHeadings(md).markdown, expected: md })
})

test(`stripCodeFence() with a fenced answer`, () => {
  const given = 'a model that wrapped the whole answer in a markdown fence'
  const should = 'return the contents without the fence'

  assert({
    given,
    should,
    actual: stripCodeFence('```markdown\n## Summary\nText.\n```'),
    expected: '## Summary\nText.',
  })
})

test(`stripCodeFence() with an unfenced answer containing a fence`, () => {
  const given = 'markdown that legitimately contains a code block'
  const should = 'leave it intact, since the fence does not wrap the whole answer'

  const md = '## Summary\nText.\n\n```js\nconst a = 1\n```\n\n## Next'
  assert({ given, should, actual: stripCodeFence(md), expected: md })
})

test(`splitTitle() with the expected title line`, () => {
  const given = 'an answer led by the TITLE: line the prompt asks for'
  const should = 'lift the title out and leave it out of the body'

  const { title, body } = splitTitle('TITLE: Doubting The Atlas Timeline\n\n## Summary\nText.')
  assert({ given, should, actual: title, expected: 'Doubting The Atlas Timeline' })
  assert({ given, should: 'keep the title out of the body', actual: body, expected: '## Summary\nText.' })
})

test(`splitTitle() with no title line`, () => {
  const given = 'a model that ignored the title instruction'
  const should = 'return an empty title and the body untouched, rather than failing'

  const { title, body } = splitTitle('## Summary\nText.')
  assert({ given, should, actual: title, expected: '' })
  assert({ given, should: 'leave the body alone', actual: body, expected: '## Summary\nText.' })
})

test(`nextJournalPrefix() on a day with existing journals`, async () => {
  const given = 'a day already holding 00, 01 and 06'
  const should = 'return the next number after the highest, not the first gap'

  const dir = await makeTempDir({ prefix: 'sky-journal-prefix-' })
  await mkdir(path.join(dir, 'journal'), { recursive: true })
  for (const name of ['00_health_Something.md', '01_mood_Other.md', '06_faith_Third.md', 'notes.md']) {
    await writeFile(path.join(dir, 'journal', name), '')
  }
  assert({ given, should, actual: await nextJournalPrefix(dir), expected: '07' })
})

test(`nextJournalPrefix() on a day with no journal directory`, async () => {
  const given = 'the first entry of the day'
  const should = 'start at 00 rather than throwing'

  const dir = await makeTempDir({ prefix: 'sky-journal-prefix-empty-' })
  assert({ given, should, actual: await nextJournalPrefix(dir), expected: '00' })
})
