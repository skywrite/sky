import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { quoteLegacyChannelFields } from './channelFields.ts'
import VideoDocument from './document/mod.ts'

for (const field of ['who', 'from', 'to']) {
  test(`legacy video ${field} channel survives parsing and serialization`, () => {
    const original = `---\n${field}: #atlas-updates\ncustom: keep\n---\n\n# Original notes\n`
    const video = VideoDocument.fromMarkdown(original)
    const saved = video.toMarkdown()
    assert({
      given: `an unquoted channel in the video's ${field} field`,
      should: 'read the literal channel and save it as a quoted YAML string',
      actual: {
        read: video.yaml[field],
        saved: Document.fromMarkdown(saved).yaml[field],
        quoted: saved.includes(`${field}: "#atlas-updates"`),
        body: video.markdown,
        genericParser: Document.fromMarkdown(original).yaml[field],
      },
      expected: {
        read: '#atlas-updates',
        saved: '#atlas-updates',
        quoted: true,
        body: '# Original notes\n',
        genericParser: null,
      },
    })
  })
}

test('quoting legacy channel fields preserves exact surrounding text and line endings', () => {
  const original =
    '\uFEFF---\r\n"who" : #atlas-planning  \r\nfrom: #atlas-source\r\nto: "#atlas-review"\r\ncustom: "keep this"\r\n---\r\n\r\nwho: #body-example\r\n'
  const expected = original
    .replace('"who" : #atlas-planning', '"who" : "#atlas-planning"')
    .replace('from: #atlas-source', 'from: "#atlas-source"')
  const result = quoteLegacyChannelFields(original)
  assert({
    given: 'multiple participant fields, CRLF, a quoted key, and a body example',
    should: 'change only legacy channel tokens and do nothing on a second pass',
    actual: { text: result, repeated: quoteLegacyChannelFields(result) },
    expected: { text: expected, repeated: expected },
  })
})

test('channel recovery ignores comments, nested fields and multiline scalar content', () => {
  const original = `---
who: # add a participant
from: Jane Doe #atlas-source
to: "#atlas-review"
custom:
  who: #atlas-nested
summary: "First line
  who: #atlas-example
  Last line"
notes: |
  from: #atlas-literal
---

who: #atlas-body
`
  assert({
    given: 'channel-shaped text outside an empty top-level participant field',
    should: 'leave the entire document unchanged',
    actual: { yamlError: Document.fromMarkdown(original).yamlError, text: quoteLegacyChannelFields(original) },
    expected: { yamlError: undefined, text: original },
  })
})

test('channel recovery leaves invalid or absent frontmatter for the normal parser', () => {
  const cases = [
    'who: #atlas-body\n',
    '---\nwho: #atlas-unclosed\n',
    '---\nwho: #atlas-updates\ncustom: [unterminated\n---\n',
    '---\n- who: #atlas-nested\n---\n',
  ]
  assert({
    given: 'missing, invalid, or non-mapping frontmatter',
    should: 'avoid guessing or repairing unrelated YAML',
    actual: cases.map(quoteLegacyChannelFields),
    expected: cases,
  })
})
