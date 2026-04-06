import { assert, loadFixturesSync, test } from '#test'
import {
  parseMarkdownSourceDocument,
  replaceBlockRaw,
  replaceInBlock,
  serializeMarkdownSourceDocument,
} from './sourceDocument.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('markdown preview editor-core preservation fixtures round-trip byte-identically', () => {
  for (const [name, source] of Object.entries(FIXTURES)) {
    const document = parseMarkdownSourceDocument(source)

    assert({
      given: `${name} fixture`,
      should: 'round-trip byte-identically',
      actual: serializeMarkdownSourceDocument(document),
      expected: source,
    })
  }
})

test('markdown preview editor-core preserves exact empty frontmatter and reference definition gaps', () => {
  const source = FIXTURES['next-actions-orbit.md']!
  const document = parseMarkdownSourceDocument(source)
  const trailingGap = document.segments.findLast((segment) => segment.kind === 'gap')
  const expectedFrontmatterRaw = source.slice(0, source.indexOf('# Next Actions Orbit'))

  assert({
    given: 'fixture with empty frontmatter',
    should: 'preserve the exact opening frontmatter block',
    actual: document.frontmatterRaw,
    expected: expectedFrontmatterRaw,
  })

  assert({
    given: 'fixture with trailing reference definitions',
    should: 'keep them in a preserved raw gap segment',
    actual: trailingGap?.kind === 'gap' && trailingGap.raw.includes('[draft-launch-memo]:'),
    expected: true,
  })
})

test('markdown preview editor-core localizes list block edits to the edited source segment', () => {
  const source = FIXTURES['next-actions-orbit.md']!
  const document = parseMarkdownSourceDocument(source)
  const block = document.blocks.find(
    (candidate) => candidate.tokenType === 'list' && candidate.raw.includes('Order welcome kits'),
  )

  if (!block) {
    throw new Error('Expected to find target list block in next-actions-orbit fixture')
  }

  const replacementRaw = block.raw.replace('Order welcome kits', 'Order premium welcome kits')
  const nextDocument = replaceBlockRaw(document, block.cid, replacementRaw)
  const prefixLength = document.frontmatterRaw.length + block.startOffset
  const suffixOffset = document.frontmatterRaw.length + block.endOffset

  assert({
    given: 'list block edit',
    should: 'only change the edited block raw segment',
    actual: serializeMarkdownSourceDocument(nextDocument),
    expected: source.slice(0, prefixLength) + replacementRaw + source.slice(suffixOffset),
  })
})

test('markdown preview editor-core localizes fence edits to the edited source segment', () => {
  const source = FIXTURES['special-blocks.md']!
  const document = parseMarkdownSourceDocument(source)
  const block = document.blocks.find(
    (candidate) => candidate.tokenType === 'code' && candidate.raw.includes('const message = "hello"'),
  )

  if (!block) {
    throw new Error('Expected to find target fence block in special-blocks fixture')
  }

  const nextDocument = replaceInBlock(document, block.cid, '"hello"', '"hello world"')
  const prefixLength = document.frontmatterRaw.length + block.startOffset
  const suffixOffset = document.frontmatterRaw.length + block.endOffset
  const replacementRaw = block.raw.replace('"hello"', '"hello world"')

  assert({
    given: 'fence block edit',
    should: 'only change the edited fence raw segment',
    actual: serializeMarkdownSourceDocument(nextDocument),
    expected: source.slice(0, prefixLength) + replacementRaw + source.slice(suffixOffset),
  })
})
