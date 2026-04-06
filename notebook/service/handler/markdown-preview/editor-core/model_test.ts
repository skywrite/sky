import { assert, loadFixturesSync, test } from '#test'
import { parseEditorDocument } from './parse.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('editor-core model parses representative notebook structures into stable block types', () => {
  const nextActions = parseEditorDocument(FIXTURES['next-actions-orbit.md']!)
  const listNode = nextActions.nodes.find((node) => node.type === 'list')
  const definitionNode = nextActions.nodes.find((node) => node.type === 'definition_cluster')
  const headingNode = nextActions.nodes.find((node) => node.type === 'heading' && node.raw.startsWith('## Next'))

  assert({
    given: 'fixture with empty frontmatter',
    should: 'produce a frontmatter node',
    actual: nextActions.frontmatter?.type,
    expected: 'frontmatter',
  })

  assert({
    given: 'fixture with a next-actions list',
    should: 'parse the list as a list node with item children',
    actual: listNode?.type === 'list' && listNode.items.length,
    expected: 6,
  })

  assert({
    given: 'fixture with a heading',
    should: 'preserve the heading marker pattern',
    actual: headingNode?.type === 'heading' ? headingNode.preservation.pattern : '',
    expected: '##',
  })

  assert({
    given: 'fixture with trailing reference definitions',
    should: 'parse them as a protected definition cluster',
    actual: definitionNode?.type === 'definition_cluster' && definitionNode.entries.length,
    expected: 5,
  })
})

test('editor-core model preserves nested list structure and indentation metadata', () => {
  const practices = parseEditorDocument(FIXTURES['practice-board.md']!)
  const listNode = practices.nodes.find((node) => node.type === 'list')

  if (!listNode || listNode.type !== 'list') {
    throw new Error('Expected practice fixture to include a list node')
  }

  const firstItem = listNode.items[0]!
  const nestedList = firstItem.blocks.find((node) => node.type === 'list')

  assert({
    given: 'fixture with nested lists',
    should: 'parse the nested list under the parent list item',
    actual: nestedList?.type === 'list' && nestedList.items.length,
    expected: 1,
  })

  assert({
    given: 'fixture with bullet markers',
    should: 'preserve the bullet pattern on the parent list item',
    actual: firstItem.preservation.pattern,
    expected: '-',
  })

  assert({
    given: 'fixture with an indented child bullet',
    should: 'capture its original indentation whitespace',
    actual: nestedList?.type === 'list' ? nestedList.items[0]!.preservation.userIndent : '',
    expected: '',
  })
})

test('editor-core model classifies protected special blocks explicitly', () => {
  const specialBlocks = parseEditorDocument(FIXTURES['special-blocks.md']!)
  const commentNode = specialBlocks.nodes.find((node) => node.type === 'html_block')
  const fenceNode = specialBlocks.nodes.find((node) => node.type === 'fence')
  const tableNode = specialBlocks.nodes.find((node) => node.type === 'table')
  const hrNode = specialBlocks.nodes.find((node) => node.type === 'hr')
  const definitionNode = specialBlocks.nodes.find((node) => node.type === 'definition_cluster')
  const paragraphNode = specialBlocks.nodes.find((node) => node.type === 'paragraph')

  assert({
    given: 'fixture with an HTML comment',
    should: 'classify it as a protected html_block comment node',
    actual: commentNode?.type === 'html_block' && commentNode.htmlKind,
    expected: 'comment',
  })

  assert({
    given: 'fixture with a fenced code block',
    should: 'preserve the original fence delimiter pattern',
    actual: fenceNode?.type === 'fence' ? fenceNode.preservation.pattern : '',
    expected: '~~~',
  })

  assert({
    given: 'fixture with a pipe table',
    should: 'classify the table as a protected table node',
    actual: tableNode?.type,
    expected: 'table',
  })

  assert({
    given: 'fixture with a thematic break',
    should: 'preserve the hr marker pattern',
    actual: hrNode?.type === 'hr' ? hrNode.preservation.pattern : '',
    expected: '---',
  })

  assert({
    given: 'fixture with trailing reference definitions',
    should: 'parse their labels structurally',
    actual: definitionNode?.type === 'definition_cluster' ? definitionNode.entries[0]?.type : '',
    expected: 'reference',
  })

  assert({
    given: 'fixture with a collapsed reference link',
    should: 'classify the inline link kind correctly',
    actual:
      paragraphNode?.type === 'paragraph' ? paragraphNode.inlines.find((node) => node.type === 'link')?.linkKind : '',
    expected: 'collapsed-reference',
  })
})
