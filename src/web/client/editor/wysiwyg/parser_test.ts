import { assert, loadFixturesSync, test } from '#test'
import { parseDocument, reparseBlock, splitTableRow } from './parser.ts'
import { serializeDocument } from './serializer.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('RT-3 every fixture round-trips byte for byte', () => {
  for (const [name, source] of Object.entries(FIXTURES)) {
    assert({
      given: `${name} opened and saved without edits`,
      should: 'reproduce the file byte for byte',
      actual: serializeDocument(parseDocument(source)),
      expected: source,
    })
  }
})

test('RT-3 line endings and the final newline are kept as found', () => {
  const crlf = parseDocument(FIXTURES['crlf.md']!)
  const bare = parseDocument(FIXTURES['no-final-newline.md']!)
  assert({
    given: 'a CRLF file and a file without a final newline',
    should: 'record both conventions',
    actual: [crlf.lineEnding, crlf.finalNewline, bare.lineEnding, bare.finalNewline],
    expected: ['\r\n', true, '\n', false],
  })
})

test('RT-1 the block shapes of a file are recognized', () => {
  const doc = parseDocument(FIXTURES['lists-nested.md']!)
  const blocks = doc.blocks
  const two = blocks[1]!.children[1]!
  const deeper = two.children[1]!.children[1]!.children[1]!.children[0]!
  assert({
    given: 'the nested-lists fixture',
    should: 'nest items by their indent and keep every list apart',
    actual: [
      blocks.map(
        (block) => block.type + (block.type === 'list' ? `:${block.style}:${block.bullet ?? block.delimiter}` : ''),
      ),
      deeper.firstChild?.text,
      blocks[4]!.start,
      blocks[6]!.isFixed,
      blocks[8]!.start,
      blocks[9]!.children.map((item) => item.checked),
      blocks[9]!.loose,
      blocks[1]!.loose,
    ],
    expected: [
      [
        'heading',
        'list:ul:-',
        'list:ul:*',
        'list:ul:+',
        'list:ol:.',
        'list:ol:)',
        'list:ol:.',
        'paragraph',
        'list:ol:.',
        'list:ul:-',
        'list:ol:.',
      ],
      'deeper',
      1,
      true,
      3,
      [false, true, true, null, null, null, null, null, null],
      true,
      false,
    ],
  })
})

test('RT-1 headings keep their spelling: ATX, closing hashes, setext', () => {
  const doc = parseDocument(FIXTURES['frontmatter-and-headings.md']!)
  const headings = doc.blocks.filter((block) => block.type === 'heading')
  assert({
    given: 'ATX headings with and without closing hashes and two setext headings',
    should: 'record depth, text and the marker pattern',
    actual: headings.map((h) => [h.depth, h.text, h.pattern]),
    expected: [
      [1, 'Atlas kickoff', '# {0}'],
      [2, 'Two blank lines above', '## {0}'],
      [3, 'Closing hashes', '### {0} ##'],
      [1, '', '#{0}'],
      [4, 'Trailing spaces', '#### {0}   '],
      [1, 'Setext one', '{0}\n=========='],
      [2, 'Setext two', '{0}\n----------'],
    ],
  })
})

test('RT-10 blank lines between blocks are counted, not normalized', () => {
  const doc = parseDocument(FIXTURES['frontmatter-and-headings.md']!)
  assert({
    given: 'two blank lines before a heading',
    should: 'store ahead = 2 on that heading',
    actual: [doc.blocks[0]!.type, doc.blocks[1]!.ahead, doc.blocks[3]!.ahead],
    expected: ['frontmatter', 1, 2],
  })
})

test('LNK-5 front matter is the first block; a lone --- is a rule', () => {
  const doc = parseDocument(FIXTURES['frontmatter-and-headings.md']!)
  const rule = parseDocument('---\n\ntext\n')
  assert({
    given: 'a file opening with a YAML block, and a file opening with --- that never closes',
    should: 'parse front matter with its text, and a thematic break',
    actual: [doc.blocks[0]!.text.split('\n')[0], doc.blocks[0]!.patternEnd, rule.blocks.map((b) => b.type)],
    expected: ['tags: atlas; planning', '---', ['hr', 'paragraph']],
  })
})

test('RT-8 fences keep their marker, info string and missing closer', () => {
  const doc = parseDocument(FIXTURES['fences.md']!)
  const fences = doc.blocks.filter((block) => block.type === 'fence')
  assert({
    given: 'backtick, tilde, four-backtick, spaced-info, empty and unterminated fences plus indented code',
    should: 'record the info string, the pattern, emptiness and the absent closer',
    actual: fences.map((f) => [f.lang, f.pattern, f.empty ?? false, f.noCloseTag ?? false, f.indented ?? false]),
    expected: [
      ['js', '```{0}', false, false, false],
      ['python', '~~~{0}', false, false, false],
      ['md', '````{0}', false, false, false],
      ['sh', '``` {0}', false, false, false],
      ['', '```{0}', false, false, false],
      ['', '```{0}', false, false, false],
      ['', '```{0}', true, false, false],
      ['', '    {0}', false, false, true],
      ['js', '```{0}', false, true, false],
    ],
  })
})

test('RT-12 / TYP-30 indented code is recognized on load only', () => {
  const source = '    code\n\ntext\n'
  const opened = parseDocument(source)
  const edited = parseDocument(source, { indentedCode: false })
  assert({
    given: 'four-space indented lines, parsed as a file and parsed as edited text',
    should: 'give a code block on load and a paragraph while editing',
    actual: [opened.blocks[0]!.type, opened.blocks[0]!.text, edited.blocks[0]!.type, edited.blocks[0]!.text],
    expected: ['fence', 'code', 'paragraph', '    code'],
  })
})

test('RT-1 quotes strip and remember their prefixes, including lazy lines', () => {
  const doc = parseDocument(FIXTURES['quotes.md']!)
  const quotes = doc.blocks.filter((block) => block.type === 'blockquote')
  const nested = quotes[1]!.children[2]!
  assert({
    given: 'quotes with spaced, unspaced, nested and lazy lines',
    should: 'record each line prefix and nest the inner quote',
    actual: [
      quotes[0]!.userIndent,
      quotes[2]!.userIndent,
      quotes[3]!.userIndent,
      nested.type,
      nested.children.map((child) => child.text),
      quotes[4]!.children.map((child) => `${child.type}:${child.style ?? ''}`),
    ],
    expected: [
      ['> ', '> '],
      ['>', '>'],
      ['> ', ''],
      'blockquote',
      ['Nested quote.', 'Still nested.'],
      ['list:ul', 'list:ol'],
    ],
  })
})

test('RT-1 tables split cells around code spans and escaped pipes', () => {
  const doc = parseDocument(FIXTURES['tables.md']!)
  const tables = doc.blocks.filter((block) => block.type === 'table')
  const second = tables[1]!
  assert({
    given: 'a table with outer pipes and alignment, and one without outer pipes',
    should: 'read alignment, header cells, and cell text with pipes masked',
    actual: [
      tables[0]!.align,
      tables[0]!.children[0]!.children.map((cell) => cell.text),
      second.children.map((row) => row.children.map((cell) => cell.text)),
      second.children[0]!.pipeStart,
      splitTableRow('| a \\| b | `c | d` | e |'),
    ],
    expected: [
      [null, 'center', 'right'],
      ['Name', 'Role', 'Score'],
      [
        ['Name', 'Value'],
        ['no outer pipes', '1'],
        ['`a | b` code pipe', '2'],
        ['escaped \\| pipe', '3'],
      ],
      false,
      { cells: [' a \\| b ', ' `c | d` ', ' e '], pipeStart: true, pipeEnd: true },
    ],
  })
})

test('RT-1 HTML blocks, rules and definitions', () => {
  const doc = parseDocument(FIXTURES['html-and-definitions.md']!)
  assert({
    given: 'comments, block tags, a lone img tag, three rule spellings and three definitions',
    should: 'give html blocks, rules with their pattern, and definitions with ref, href and title',
    actual: [
      doc.blocks.map((block) => block.type),
      doc.blocks.filter((b) => b.type === 'hr').map((b) => b.pattern),
      doc.blocks.filter((b) => b.type === 'definition').map((b) => [b.ref, b.href, b.title]),
      doc.findDefinition('jane doe')?.href ?? null,
    ],
    expected: [
      [
        'html',
        'html',
        'html',
        'paragraph',
        'html',
        'html',
        'html',
        'hr',
        'hr',
        'hr',
        'definition',
        'definition',
        'definition',
      ],
      ['***', '- - -', '___'],
      [
        ['atlas', 'https://example.com', 'Atlas home'],
        ['Jane Doe', 'https://example.com/jane', 'Jane'],
        ['plain', '/relative/path', null],
      ],
      'https://example.com/jane',
    ],
  })
})

test('RT-1 what may and may not interrupt a paragraph', () => {
  const doc = parseDocument(FIXTURES['edge-cases.md']!)
  assert({
    given: 'a pipe row, an ordered 2., a bullet, a 1., setext dashes and a heading after paragraph text',
    should: 'continue the paragraph for the 2., and start blocks for the rest',
    actual: doc.blocks.slice(0, 9).map((block) => `${block.type}${block.type === 'heading' ? block.depth : ''}`),
    expected: ['paragraph', 'table', 'paragraph', 'list', 'list', 'heading2', 'paragraph', 'hr', 'heading1'],
  })
})

test('RT-1 a table may follow paragraph text: the last line becomes the header row', () => {
  const doc = parseDocument('**Totals**\n| a | b |\n|---|---|\n| 1 | 2 |\n\nIntro line\n| x | y |\n| - | - |\n')
  assert({
    given: 'a delimiter row right after a pipe line that ended a paragraph',
    should: 'start the table at that line and keep the paragraph lines before it',
    actual: [
      doc.blocks.map((block) => block.type),
      doc.blocks[1]!.children[0]!.children.map((cell) => cell.text),
      doc.blocks[2]!.text,
      serializeDocument(doc) === '**Totals**\n| a | b |\n|---|---|\n| 1 | 2 |\n\nIntro line\n| x | y |\n| - | - |\n',
    ],
    expected: [['paragraph', 'table', 'paragraph', 'table'], ['a', 'b'], 'Intro line', true],
  })
})

test('RT-1 an item that began empty ends at a blank line', () => {
  const doc = parseDocument('-\n\n  not inside\n\n-\n- b\n')
  assert({
    given: 'an empty item, a blank line and indented text; then an empty item followed by a sibling',
    should: 'close the first list before the text and keep the second list together',
    actual: [doc.blocks.map((block) => block.type), doc.blocks[1]!.text, doc.blocks[2]!.childCount],
    expected: [['list', 'paragraph', 'list'], '  not inside', 2],
  })
})

test('§4.2 re-parsing a block says whether it still is one block of its type', () => {
  const doc = parseDocument('plain\n\n## Title\n')
  const paragraph = doc.blocks[0]!
  const same = reparseBlock(doc, paragraph)
  paragraph.text = '## Title'
  const heading = reparseBlock(doc, paragraph)
  paragraph.text = 'one\n\ntwo'
  const split = reparseBlock(doc, paragraph)
  assert({
    given: 'a paragraph whose text stays a paragraph, becomes a heading, or splits in two',
    should: 'answer null, a heading, and two paragraphs',
    actual: [same, heading?.map((n) => `${n.type}${n.depth}:${n.text}`), split?.map((n) => `${n.type}:${n.text}`)],
    expected: [null, ['heading2:Title'], ['paragraph:one', 'paragraph:two']],
  })
})
