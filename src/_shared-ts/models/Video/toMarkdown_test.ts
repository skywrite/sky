import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import VideoDocument from '#shared/models/Video/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'fixtures')

test(`VideoDocument.fromMarkdown() with fixture`, async () => {
  const given = 'Parse Video from fixture file'

  const markdown = await readTextFile(path.join(DIR_FIXTURES, 'basic-video.md'))
  const v = VideoDocument.fromMarkdown(markdown)

  assert({ given, should: 'restore from', expected: 'Jane Doe', actual: v.from })
  assert({ given, should: 'restore to', expected: 'Atlas Team', actual: v.to })
  assert({ given, should: 'parse when correctly', expected: '09:46', actual: v.when.time })
  assert({ given, should: 'parse medium correctly', expected: 'Loom', actual: v.medium })
  assert({ given, should: 'parse summary correctly', expected: 'Weekly product update', actual: v.summary })
})

test(`new VideoDocument()`, () => {
  const given = 'Create Video w/ props'

  const when = new PlainDateTime(new Date(2022, 10, 17, 20, 24))
  const v = new VideoDocument({ from: 'Jane Doe', to: 'Atlas Team', when, medium: 'YouTube', summary: 'test summary' })

  assert({ given, should: 'have correct from', expected: 'Jane Doe', actual: v.from })
  assert({ given, should: 'have correct to', expected: 'Atlas Team', actual: v.to })
  assert({ given, should: 'have correct when time', expected: '20:24', actual: v.when.time })
  assert({ given, should: 'have correct medium', expected: 'YouTube', actual: v.medium })
  assert({ given, should: 'have correct summary', expected: 'test summary', actual: v.summary })
})

test(`new VideoDocument() defaults`, () => {
  const given = 'Create Video with minimal props'

  const v = new VideoDocument({ summary: 'test' })

  assert({ given, should: 'default medium to Video', expected: 'Video', actual: v.medium })
  assert({ given, should: 'have a default when time', expected: true, actual: v.when.time.length > 0 })
  assert({ given, should: 'omit from when not given', expected: undefined, actual: v.from })
  assert({ given, should: 'omit to when not given', expected: undefined, actual: v.to })
  assert({ given, should: 'default video url to null', expected: undefined, actual: v.videoUrl })
})

test(`VideoDocument.videoUrl`, () => {
  const given = 'A video with a url set'

  const v = VideoDocument.fromMarkdown(`---
when: 09:46
medium: YouTube
video:
  url: https://example.com/watch?v=abc123
---

# YouTube
`)

  assert({
    given,
    should: 'read the nested video.url field',
    expected: 'https://example.com/watch?v=abc123',
    actual: v.videoUrl,
  })
})

test(`VideoDocument.toMarkdown()`, () => {
  const given = 'Create Video w/ props'

  const when = new PlainDateTime(new Date(2022, 10, 17, 20, 24))
  const md = new VideoDocument({ from: 'Jane Doe', when, medium: 'Loom' }).toMarkdown()

  assert({ given, should: 'render yaml frontmatter', expected: true, actual: md.startsWith('---\n') })
  assert({ given, should: 'include from field', expected: true, actual: md.includes('from: Jane Doe') })
  assert({ given, should: 'include when field', expected: true, actual: md.includes('when: 20:24') })
  assert({ given, should: 'include medium field', expected: true, actual: md.includes('medium: Loom') })
  assert({ given, should: 'include the nested video key', expected: true, actual: md.includes('video:\n  url:') })
  assert({ given, should: 'include default heading', expected: true, actual: md.includes('# Video') })
  assert({ given, should: 'include Summary section', expected: true, actual: md.includes('## Summary') })
  assert({ given, should: 'include Transcript section', expected: true, actual: md.includes('## Transcript') })
})

test(`VideoDocument yaml key order`, () => {
  const given = 'A video parsed with keys out of display order'

  const v = VideoDocument.fromMarkdown(`---
tags: alpha
when: 09:46
from: Jane Doe
medium: Loom
---

# Loom
`)

  const keys = v
    .toMarkdown()
    .split('\n')
    .filter((l) => /^[a-z]+:/.test(l))
    .map((l) => l.split(':')[0])

  assert({
    given,
    should: 'reorder to the canonical display order',
    expected: ['from', 'when', 'medium', 'tags'],
    actual: keys,
  })
})

test(`new VideoDocument() with a custom body`, () => {
  const given = 'Create Video with a body override'

  const v = new VideoDocument({ medium: 'Loom', body: '# Loom\n\n## Summary' })

  assert({
    given,
    should: 'use the supplied body',
    expected: true,
    actual: v.toMarkdown().endsWith('# Loom\n\n## Summary'),
  })
  assert({ given, should: 'not leak body into yaml', expected: undefined, actual: v.yaml['body'] })
})
