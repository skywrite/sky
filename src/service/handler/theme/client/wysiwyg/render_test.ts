import { assert, test } from '#test'
import { parseDocument } from './parser.ts'
import { contextFor, renderExport, renderStatic } from './render.ts'

test('renderStatic renders markdown as semantic HTML', () => {
  assert({
    given: 'a heading and a list with emphasis',
    should: 'emit clean tags with no markdown syntax left',
    actual: renderStatic('### Atlas\n\n- **bold** item\n'),
    expected: '<h3>Atlas</h3>\n<ul><li><strong>bold</strong> item</li></ul>',
  })
})

test('renderStatic shows raw HTML as text', () => {
  assert({
    given: 'a reply quoting an HTML block and an inline tag',
    should: 'escape both instead of injecting them',
    actual: renderStatic('<script>alert(1)</script>\n\nafter <b>x</b> end\n'),
    expected: '<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>\n<p>after &lt;b&gt;x&lt;/b&gt; end</p>',
  })
})

test('renderStatic shows front matter instead of dropping it', () => {
  assert({
    given: 'a reply that opens with a front matter fence',
    should: 'keep the fenced lines visible as text',
    actual: renderStatic('---\ntags: a\n---\nbody\n'),
    expected: '<pre>tags: a</pre>\n<p>body</p>',
  })
})

test('clipboard export still passes raw HTML through', () => {
  const doc = parseDocument('a <b>b</b> c\n')
  assert({
    given: 'an export without the raw-as-text flag',
    should: 'keep inline HTML live, as the clipboard wants',
    actual: renderExport(doc.blocks, contextFor(doc)),
    expected: '<p>a <b>b</b> c</p>',
  })
})
