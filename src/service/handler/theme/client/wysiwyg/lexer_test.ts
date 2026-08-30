import { assert, loadFixturesSync, test } from '#test'
import { renderInline } from './decorate.ts'
import { type InlineNode, lexInline, plainText, sourceOfAll } from './lexer.ts'
import { parseDocument } from './parser.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

/** What a browser would give as textContent of the editing HTML: tags dropped, entities restored. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function shape(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return JSON.stringify(node.text)
        case 'emphasis':
          return `${node.kind}(${shape(node.children)})`
        case 'link':
          return `link:${node.form}(${shape(node.children)}→${node.href})`
        case 'image':
          return `image(${node.alt}→${node.src})`
        case 'underline':
          return `u(${shape(node.children)})`
        case 'code':
          return `code(${node.inner})`
        case 'autolink':
          return `auto(${node.href})`
        default:
          return node.type
      }
    })
    .join(' ')
}

const definitions = (label: string) =>
  ({
    'atlas-site': { href: 'https://example.com', title: null },
    'atlas-img': { href: 'images/atlas.png', title: 'Atlas' },
  })[label.toLowerCase()] ?? null

test('§2.3 the editing rendering of every fixture block reads back as its source', () => {
  const checked: string[] = []
  for (const [name, source] of Object.entries(FIXTURES)) {
    const doc = parseDocument(source)
    for (const node of doc.root.walk()) {
      if (!node.isInline()) continue
      const html = renderInline(lexInline(node.text, { findDefinition: definitions }), 'editing')
      if (textOf(html) !== node.text) checked.push(`${name}: ${JSON.stringify(node.text)}`)
    }
  }
  assert({
    given: 'every paragraph, heading and cell in the fixtures, lexed and rendered for editing',
    should: 'have a textContent identical to the markdown it came from',
    actual: checked,
    expected: [],
  })
})

test('§4.3 lexing then sourceOf is the identity', () => {
  const samples = [
    'plain **strong** *em* ~~gone~~ ==hi== `co de` [a](b "c") ![i](j) <https://x.y> https://a.b/c?d=1. <u>u</u> line  \nbreak\\\nnext\nsoft \\* &amp;',
    '***both*** **a *b* c** *a **b** c* _e_ __s__ in*ter*nal snake_case_name',
    '[text][atlas-site] [atlas-site][] [atlas-site] [nope] [x] [ ] ![img][atlas-img]',
    '**unclosed *a `b` <!-- c --> <span class="x">d</span> ``a ` b`` `  ` * a* **a ** *a',
  ]
  assert({
    given: 'strings covering every construct and several ill-formed ones',
    should: 'reproduce the input from the node tree',
    actual: samples.map((s) => sourceOfAll(lexInline(s, { findDefinition: definitions })) === s),
    expected: [true, true, true, true],
  })
})

test('TYP-2 every supported construct is recognized', () => {
  assert({
    given: 'one of each inline construct',
    should: 'produce the matching node',
    actual: shape(
      lexInline(
        '*em* _em_ **strong** __strong__ ***both*** `code` ~~strike~~ ==hi== [t](u "ti") ![a](s "t") [t][atlas-site] ![a][atlas-img] <https://e.x> https://e.x/p www.e.x \\* <u>u</u> <!-- c --> <br> <span>x</span>',
        { findDefinition: definitions },
      ),
    ),
    expected:
      'em("em") " " em("em") " " strong("strong") " " strong("strong") " " em(strong("both")) " " code(code) " " strike("strike") " " highlight("hi") " " link:inline("t"→u) " " image(a→s) " " link:full("t"→https://example.com) " " image(a→images/atlas.png) " " auto(https://e.x) " " auto(https://e.x/p) " " auto(http://www.e.x) " " escape " " u("u") " " html " " html " " html "x" html',
  })
})

test('TYP-4 unbalanced or ill-formed markers stay literal', () => {
  const cases = ['*a', '* a*', '**a **', '`', '[text](', 'a ** b', '_ x_', '~~~three~~~', '===']
  assert({
    given: 'markers that never close, or close with the wrong spacing',
    should: 'lex as plain text',
    actual: cases.map((c) => shape(lexInline(c))),
    expected: cases.map((c) => JSON.stringify(c)),
  })
})

test('TYP-5 underscores inside words are literal; asterisks inside words are not', () => {
  assert({
    given: 'snake_case_name and in*ter*nal',
    should: 'keep the underscores and italicize ter',
    actual: [shape(lexInline('snake_case_name')), shape(lexInline('in*ter*nal'))],
    expected: ['"snake_case_name"', '"in" em("ter") "nal"'],
  })
})

test('TYP-6 code spans are literal inside, and padding spaces move into the syntax', () => {
  const nodes = lexInline('`**x**` `` a ` b `` ` c ` `  `')
  assert({
    given: 'code spans holding markers, backticks, padding and only spaces',
    should: 'keep the inside verbatim and strip one padding space each side when both exist',
    actual: nodes.filter((n) => n.type === 'code').map((n) => n.type === 'code' && [n.open, n.pre, n.inner, n.post]),
    expected: [
      ['`', '', '**x**', ''],
      ['``', ' ', 'a ` b', ' '],
      ['`', ' ', 'c', ' '],
      ['`', '', '  ', ''],
    ],
  })
})

test('TYP-7 a newline is a soft break; two trailing spaces or a backslash make a hard break', () => {
  assert({
    given: 'lines ending in nothing, two spaces, and a backslash',
    should: 'lex a soft break and two hard breaks with their exact text',
    actual: lexInline('a\nb  \nc\\\nd').map((n) => (n.type === 'hardbreak' ? `hard${JSON.stringify(n.text)}` : n.type)),
    expected: ['text', 'softbreak', 'text', 'hard"  \\n"', 'text', 'hard"\\\\\\n"', 'text'],
  })
})

test('§4.3 emphasis follows the CommonMark delimiter rules', () => {
  const cases: Array<[string, string]> = [
    ['*foo**bar**baz*', 'em("foo" strong("bar") "baz")'],
    ['**foo*bar*baz**', 'strong("foo" em("bar") "baz")'],
    ['*foo**bar*', 'em("foo**bar")'],
    ['foo***bar***baz', '"foo" em(strong("bar")) "baz"'],
    ['**foo**bar', 'strong("foo") "bar"'],
    ['*foo*bar', 'em("foo") "bar"'],
    ['__foo__bar', '"__foo__bar"'],
    ['foo-*(bar)*', '"foo-" em("(bar)")'],
    ['**Atlas:** ready', 'strong("Atlas:") " ready"'],
    ['~~a~~ ~b~ ~~c~', 'strike("a") " " strike("b") " ~~c~"'],
  ]
  assert({
    given: 'spec examples for nesting, the rule of three and intraword underscores',
    should: 'match the CommonMark outcome',
    actual: cases.map(([input]) => shape(lexInline(input))),
    expected: cases.map(([, expected]) => expected),
  })
})

test('LNK-1 references resolve against definitions; unresolved full references still link', () => {
  const nodes = lexInline('[a][atlas-site] [atlas-site][] [Atlas-Site] [a][nope] [nope] [x] [ ]', {
    findDefinition: definitions,
  })
  assert({
    given: 'full, collapsed, shortcut and unresolved references plus bare brackets',
    should: 'link the defined ones (case-insensitively), link an unresolved full reference, leave the rest as text',
    actual: shape(nodes),
    expected:
      'link:full("a"→https://example.com) " " link:collapsed("atlas-site"→https://example.com) " " link:shortcut("Atlas-Site"→https://example.com) " " link:full("a"→) " [nope] [x] [ ]"',
  })
})

test('§4.3 links may hold emphasis and images but never another link', () => {
  assert({
    given: 'a link containing strong text and an image, and a link inside a link',
    should: 'nest the emphasis and image, and turn the inner link into text',
    actual: [
      shape(lexInline('[**b** ![i](s)](u)')),
      shape(lexInline('[a [b](c) d](e)')),
      plainText(lexInline('[**b** ![i](s)](u)')),
    ],
    expected: ['link:inline(strong("b") " " image(i→s)→u)', '"[a " link:inline("b"→c) " d](e)"', 'b i'],
  })
})

test('§4.3 inline link destinations: angle brackets, parentheses, titles, escapes', () => {
  const nodes = lexInline('[a](<x y> "t") [b](u(v)) [c](u \'t\') [d](u (t)) [e](u\\)v) [f](u "unterminated)')
  assert({
    given: 'destinations with spaces in angle brackets, balanced parens, three title quotes, escapes',
    should: 'read href and title, and fall back to text when the title never closes',
    actual: nodes.filter((n) => n.type === 'link').map((n) => n.type === 'link' && [n.href, n.title, n.destRaw]),
    expected: [
      ['x y', 't', '<x y> "t"'],
      ['u(v)', null, 'u(v)'],
      ['u', 't', "u 't'"],
      ['u', 't', 'u (t)'],
      ['u)v', null, 'u\\)v'],
    ],
  })
})

test('§4.3 bare URLs stop at whitespace and drop trailing punctuation and unbalanced parens', () => {
  assert({
    given: 'URLs ending in a period, a comma, a balanced and an unbalanced paren, and inside emphasis',
    should: 'link the URL and leave the punctuation outside',
    actual: shape(lexInline('see https://a.b/c. or www.x.y/z, (https://a.b/(c)) *https://a.b*')),
    expected:
      '"see " auto(https://a.b/c) ". or " auto(http://www.x.y/z) ", (" auto(https://a.b/(c)) ") " em(auto(https://a.b))',
  })
})

test('§2.3 the editing decorator emits wrapper, syntax and content spans', () => {
  const html = renderInline(lexInline('a **b** [c](d "e") ![f](g)'), 'editing', {
    resolveImage: (src) => `/img/${src}`,
  })
  assert({
    given: 'text with strong, a titled link and an image',
    should: 'wrap each construct with hidden syntax spans and keep the source as textContent',
    actual: [html, textOf(html)],
    expected: [
      '<span data-inline="plain">a </span>' +
        '<span data-inline="strong" class="paired"><span class="syntax before">**</span><strong><span data-inline="plain">b</span></strong><span class="syntax after">**</span></span>' +
        '<span data-inline="plain"> </span>' +
        '<span data-inline="link" data-form="inline"><span class="syntax before">[</span><a href="d" title="e" spellcheck="false"><span data-inline="plain">c</span></a><span class="syntax">](</span><span class="content url">d "e"</span><span class="syntax after">)</span></span>' +
        '<span data-inline="plain"> </span>' +
        '<span data-inline="image" contenteditable="false"><span class="syntax content" contenteditable="true">![f](g)</span><img src="/img/g" alt="f"></span>',
      'a **b** [c](d "e") ![f](g)',
    ],
  })
})

test('RT-13 the export decorator emits clean semantic HTML with no syntax', () => {
  const html = renderInline(
    lexInline('**a** *b* `c` ~~d~~ ==e== [f](g "h") ![i](j) <https://k.l> \\* <u>m</u> n  \no\np &amp; <b>q</b>', {
      findDefinition: definitions,
    }),
    'export',
  )
  assert({
    given: 'every construct',
    should: 'render tags only',
    actual: html,
    expected:
      '<strong>a</strong> <em>b</em> <code>c</code> <del>d</del> <mark>e</mark> <a href="g" title="h">f</a> <img src="j" alt="i"> <a href="https://k.l">https://k.l</a> * <u>m</u> n<br>\no\np &amp;amp; <b>q</b>',
  })
})
