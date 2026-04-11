import { assert, loadFixturesSync, test } from '#test'
import type { EditorDocument, LinkInlineNode, ListItemNode, TextInlineNode } from './model.ts'
import { parseEditorDocument } from './parse.ts'
import { serializeEditorDocument } from './serialize.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('editor-core parser and serializer round-trip fixture corpus byte-identically', () => {
  for (const [name, source] of Object.entries(FIXTURES)) {
    const document = parseEditorDocument(source)

    assert({
      given: `${name} fixture`,
      should: 'round-trip byte-identically through editor-core parse/serialize',
      actual: serializeEditorDocument(document),
      expected: source,
    })
  }
})

test('editor-core serializer emits sensible markdown for synthetic nodes', () => {
  const guideLink: LinkInlineNode = {
    kind: 'inline',
    type: 'link',
    cid: 'inline-2',
    raw: '',
    protected: false,
    preservation: {},
    href: 'https://example.com/guide',
    title: null,
    linkKind: 'reference',
    referenceLabel: 'guide',
    children: [textInline('inline-2-1', 'Guide')],
  }

  const topListItem: ListItemNode = {
    kind: 'block',
    type: 'list_item',
    cid: 'item-1',
    raw: '',
    protected: false,
    preservation: {
      pattern: '+',
      prespace: '',
      markindent: ' ',
      userIndent: '',
    },
    checked: true,
    loose: false,
    inlines: [textInline('inline-3', 'Ship parser')],
    blocks: [],
  }

  const secondListItem: ListItemNode = {
    kind: 'block',
    type: 'list_item',
    cid: 'item-2',
    raw: '',
    protected: false,
    preservation: {
      pattern: '+',
      prespace: '',
      markindent: ' ',
      userIndent: '',
    },
    checked: null,
    loose: false,
    inlines: [textInline('inline-4', 'Draft docs')],
    blocks: [],
  }

  const document: EditorDocument = {
    frontmatter: null,
    nodes: [
      {
        kind: 'block',
        type: 'heading',
        cid: 'heading-1',
        raw: '',
        protected: false,
        preservation: { pattern: '##' },
        depth: 2,
        inlines: [textInline('inline-1', 'Plan')],
      },
      {
        kind: 'block',
        type: 'paragraph',
        cid: 'paragraph-1',
        raw: '',
        protected: false,
        preservation: {},
        inlines: [textInline('inline-1-1', 'Read '), guideLink, textInline('inline-1-2', '.')],
      },
      {
        kind: 'block',
        type: 'list',
        cid: 'list-1',
        raw: '',
        protected: false,
        preservation: { pattern: '+' },
        ordered: false,
        start: '',
        loose: false,
        items: [topListItem, secondListItem],
      },
      {
        kind: 'block',
        type: 'hr',
        cid: 'hr-1',
        raw: '',
        protected: false,
        preservation: { pattern: '***' },
      },
      {
        kind: 'block',
        type: 'definition_cluster',
        cid: 'defs-1',
        raw: '',
        protected: true,
        preservation: {},
        entries: [
          {
            type: 'reference',
            label: 'guide',
            href: 'https://example.com/guide',
            title: 'Guide',
          },
          {
            type: 'footnote',
            label: 'note',
            body: 'First line\nsecond line',
          },
        ],
      },
    ],
    allBlocks: [topListItem, secondListItem],
  }

  const markdown = serializeEditorDocument(document)

  assert({
    given: 'synthetic node tree',
    should: 'serialize using preserved syntax patterns and sane defaults',
    actual: markdown,
    expected:
      '## Plan\n\nRead [Guide][guide].\n\n+ [x] Ship parser\n+ Draft docs\n\n***\n\n[guide]: https://example.com/guide "Guide"\n[^note]: First line\n  second line\n',
  })
})

test('editor-core parser captures multiline footnotes and quoted reference titles', () => {
  const source = ["[guide]: https://example.com/guide 'Guide'", '[^note]: First line', '  second line', ''].join('\n')

  const document = parseEditorDocument(source)
  const definitionClusters = document.nodes.filter((node) => node.type === 'definition_cluster')
  const allEntries = definitionClusters.flatMap((node) => node.entries)
  const referenceEntry = allEntries.find((entry) => entry.type === 'reference')
  const footnoteEntry = allEntries.find((entry) => entry.type === 'footnote')

  assert({
    given: 'single-quoted reference definition title',
    should: 'preserve the reference title content',
    actual: referenceEntry?.type === 'reference' ? referenceEntry.title : '',
    expected: 'Guide',
  })

  assert({
    given: 'multiline footnote definition',
    should: 'preserve continuation lines in the footnote body',
    actual: footnoteEntry?.type === 'footnote' ? footnoteEntry.body : '',
    expected: 'First line\nsecond line',
  })
})

function textInline(cid: string, text: string): TextInlineNode {
  return {
    kind: 'inline',
    type: 'text',
    cid,
    raw: '',
    protected: false,
    preservation: {},
    text,
  }
}
