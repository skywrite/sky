import { assert, loadFixturesSync, test } from '#test'
import SectionDocument from './mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

interface ExpectedPosition {
  heading: string
  startLine?: number
  startChar?: number
  endLine?: number
}

const fixtures: { file: string; description: string; expected: ExpectedPosition[] }[] = [
  {
    file: 'positions-flat.md',
    description: 'flat sibling sections',
    expected: [
      { heading: 'Section A', startLine: 0, startChar: 0, endLine: 4 },
      { heading: 'Section B', startLine: 4, startChar: 0 },
    ],
  },
  {
    file: 'positions-nested.md',
    description: 'nested hierarchy',
    expected: [
      { heading: 'H1', startLine: 0, startChar: 0 },
      { heading: 'H2', startLine: 2, startChar: 0 },
      { heading: 'H3', startLine: 4, startChar: 0 },
    ],
  },
  {
    file: 'positions-empty.md',
    description: 'adjacent headings (empty sections)',
    expected: [
      { heading: 'Empty', startLine: 0, startChar: 0, endLine: 2 },
      { heading: 'Has Content', startLine: 2, startChar: 0 },
    ],
  },
  {
    file: 'positions-with-yaml.md',
    description: 'YAML frontmatter (positions are markdown-relative)',
    expected: [
      { heading: 'Section A', startChar: 0 },
      { heading: 'Section B', startChar: 0 },
    ],
  },
]

fixtures.forEach((fixture) => {
  test(`positions: ${fixture.description}`, () => {
    const doc = SectionDocument.fromMarkdown(FIXTURES[fixture.file])
    const allSections = doc.getAllSections()

    for (const exp of fixture.expected) {
      const section = allSections.find((s) => s.heading === exp.heading)

      if (exp.startLine !== undefined) {
        assert({
          given: `${fixture.description}, section "${exp.heading}"`,
          should: `start at line ${exp.startLine}`,
          actual: section?.start.line,
          expected: exp.startLine,
        })
      }

      if (exp.startChar !== undefined) {
        assert({
          given: `${fixture.description}, section "${exp.heading}"`,
          should: `start at char ${exp.startChar}`,
          actual: section?.start.char,
          expected: exp.startChar,
        })
      }

      if (exp.endLine !== undefined) {
        assert({
          given: `${fixture.description}, section "${exp.heading}"`,
          should: `end at line ${exp.endLine}`,
          actual: section?.end.line,
          expected: exp.endLine,
        })
      }
    }
  })
})

test('positions: sibling end matches next sibling start', () => {
  const doc = SectionDocument.fromMarkdown(FIXTURES['positions-flat.md'])
  const [a, b] = doc.sections

  assert({
    given: 'two sibling sections',
    should: 'have first section end where second starts',
    actual: { line: a.end.line, char: a.end.char },
    expected: { line: b.start.line, char: b.start.char },
  })
})

test('positions: nested sections share end position', () => {
  const doc = SectionDocument.fromMarkdown(FIXTURES['positions-nested.md'])
  const h1 = doc.sections[0]
  const h2 = h1.children[0]
  const h3 = h2.children[0]

  assert({
    given: 'nested H1 > H2 > H3 with no following siblings',
    should: 'all end at the same position (document end)',
    actual: [h1.end.line, h2.end.line],
    expected: [h3.end.line, h3.end.line],
  })
})

test('positions: YAML section B starts where A ends', () => {
  const doc = SectionDocument.fromMarkdown(FIXTURES['positions-with-yaml.md'])
  const [a, b] = doc.sections

  assert({
    given: 'document with YAML frontmatter',
    should: 'have section B start where section A ends',
    actual: { line: b.start.line, char: b.start.char },
    expected: { line: a.end.line, char: a.end.char },
  })
})
