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

test('renderStatic keeps email approval entities from being escaped twice', () => {
  assert({
    given: 'an email approval with encoded recipient brackets and an ampersand in the subject',
    should: 'leave character references for the browser to display as text',
    actual: renderStatic(
      '  Account: (default)\n  To:      Jane Doe &lt;jane@example.com&gt;\n  Subject: Atlas &amp; Widget-V2\n\n---\n\nReady for review.',
    ),
    expected:
      '<p>  Account: (default)\n  To:      Jane Doe &lt;jane@example.com&gt;\n  Subject: Atlas &amp; Widget-V2</p>\n<hr>\n<p>Ready for review.</p>',
  })
})

test('renderStatic handles entities as text without decoding code or introducing markup', () => {
  for (const [source, expected] of [
    ['A & B < 3 > 1', '<p>A &amp; B &lt; 3 &gt; 1</p>'],
    ['&#60;Jane&#x3E; &mdash; &#X1F44B;', '<p>&#60;Jane&#x3E; &mdash; &#X1F44B;</p>'],
    ['**Jane &amp; Doe**', '<p><strong>Jane &amp; Doe</strong></p>'],
    ['&amp;lt; &lt &amp &#12345678;', '<p>&amp;lt; &amp;lt &amp;amp &amp;#12345678;</p>'],
    ['&lt;script&gt;alert(1)&lt;/script&gt;', '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'],
    ['&#42;literal&#42;', '<p>&#42;literal&#42;</p>'],
    ['`&lt;` and \\&lt;', '<p><code>&amp;lt;</code> and &amp;lt;</p>'],
    ['```text\n&lt;Jane&gt;\n```', '<pre><code class="language-text">&amp;lt;Jane&amp;gt;</code></pre>'],
  ]) {
    assert({
      given: source,
      should: 'render prose entities once while keeping literal syntax and HTML inert',
      actual: renderStatic(source!),
      expected,
    })
  }
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
