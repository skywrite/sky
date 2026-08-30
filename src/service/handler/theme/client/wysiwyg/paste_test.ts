import { assert, test } from '#test'
import type { MarkdownDocument, Node } from './model.ts'
import { parseDocument } from './parser.ts'
import { pasteText } from './paste.ts'
import { contextFor, renderExport } from './render.ts'
import { serializeDocument } from './serializer.ts'

function leaf(doc: MarkdownDocument, index: number): Node {
  const leaves = [...doc.root.walk()].filter((node) => node.isLeaf() && node.type !== 'hr')
  return leaves[index]!
}

test('CLP-7 CLP-8 CLP-9 CLP-10 CLP-11 paste on the model', () => {
  const run = (source: string, index: number, caret: number, text: string, literal = false) => {
    const doc = parseDocument(source)
    const landing = pasteText(doc, leaf(doc, index), caret, text, literal)
    return [serializeDocument(doc), landing.leaf.text, landing.offset]
  }
  assert({
    given:
      'one line into a paragraph; blocks into the middle of a paragraph; into a heading, a fence, a cell, an item; and literally',
    should:
      'insert inline, make blocks joining the first line and re-attaching the tail, keep one line, stay literal, use <br>, splice items',
    actual: [
      run('ab\n', 0, 1, 'X'),
      run('abcd\n', 0, 2, 'first\n\n# Head\n\n- a\n- b'),
      run('abcd\n', 0, 2, '# Head\n\ntail'),
      run('# T\n', 0, 1, 'x\ny'),
      run('```\ncode\n```\n', 0, 4, '\n# not a heading\n'),
      run('| a |\n|---|\n| b |\n', 1, 1, 'x\ny'),
      run('- one\n- two\n', 0, 3, '- x\n- y\n\npara'),
      run('a `co de` b\n', 0, 5, '1\n2', true),
    ],
    expected: [
      ['aXb\n', 'aXb', 2],
      ['abfirst\n\n# Head\n\n- a\n- bcd\n', 'bcd', 1],
      ['ab\n\n# Head\n\ntailcd\n', 'tailcd', 4],
      ['# Tx\n', 'Tx', 2],
      ['```\ncode\n# not a heading\n\n```\n', 'code\n# not a heading\n', 21],
      ['| a       |\n| ------- |\n| bx<br>y |\n', 'bx<br>y', 7],
      ['- one\n- x\n- y\n- para\n- two\n', 'para', 4],
      ['a `co1\n2 de` b\n', 'a `co1\n2 de` b', 8],
    ],
  })
})

test('RT-13 the export rendering is clean semantic HTML', () => {
  const doc = parseDocument(
    '# T\n\npara **b**\n\n- [x] done\n- item\n\n> q\n\n```js\nlet a\n```\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\n---\n',
  )
  assert({
    given: 'a document with every block kind',
    should: 'render tags with no syntax spans and no editor attributes',
    actual: renderExport(doc.blocks, contextFor(doc)),
    expected:
      '<h1>T</h1>\n<p>para <strong>b</strong></p>\n<ul><li><input type="checkbox" disabled checked> done</li>\n<li>item</li></ul>\n<blockquote><p>q</p></blockquote>\n<pre><code class="language-js">let a</code></pre>\n<table><thead><tr><th style="text-align:left">a</th><th style="text-align:right">b</th></tr></thead><tbody><tr><td style="text-align:left">1</td><td style="text-align:right">2</td></tr></tbody></table>\n<hr>',
  })
})
