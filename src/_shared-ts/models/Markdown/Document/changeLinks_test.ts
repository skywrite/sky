import { parse } from 'yaml'
import { assert, test } from '#test'
import { changeLinks } from './changeLinks.ts'

test('link updates accept empty frontmatter and retain BOM, CRLF and the exact body', () => {
  const source = '\uFEFF---\r\n---\r\n\r\nFirst paragraph.\r\n\r\nSecond paragraph.\r\n'
  const changed = changeLinks(source, ['places/FR'], [])
  const metadata = parse(changed.split('---')[1]!)
  assert({
    given: 'valid empty frontmatter followed by two paragraphs',
    should: 'add rel without a second YAML header or a body rewrite',
    actual: [
      metadata.rel,
      changed.startsWith('\uFEFF---\r\n'),
      changed.slice(changed.indexOf('\r\n---\r\n') + 7),
      changeLinks(changed, ['places/FR'], []) === changed,
    ],
    expected: [['places/FR'], true, '\r\nFirst paragraph.\r\n\r\nSecond paragraph.\r\n', true],
  })
})
