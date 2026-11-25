import { assert, test } from '#test'
import { tokenizeMarkdown } from './highlightMarkdown.ts'

function rejoin(text: string): string {
  return tokenizeMarkdown(text)
    .map((line) => line.map((token) => token.text).join(''))
    .join('\n')
}

test('tokenizeMarkdown — preserves every character exactly across markdown constructs and line endings', () => {
  const samples = [
    '',
    'Plain text only',
    '# Heading\n\nWith **bold**, *italic*, ~~strike~~, `code`, and [Atlas](https://example.com/atlas).\n',
    '---\ntitle: Whiteboard\ntags: Notes\n---\n\n## Tasks\n- [x] Done item\n- [ ] Open **task**\n> Quote line\n\n---\n',
    '```ts\nconst x = **not bold**\n```\nAfter fence *italic*',
    'Unclosed **bold and `code and [link](missing',
    'Windows\r\nlines\r\n# Heading\r\n',
    'Trailing newline\n',
  ]

  for (const sample of samples) {
    assert({
      given: `markdown sample ${JSON.stringify(sample)}`,
      should: 'reconstruct the exact original string when token texts are concatenated',
      actual: rejoin(sample),
      expected: sample,
    })
  }
})

test('tokenizeMarkdown — classifies headings, checklists, links, inline code, and frontmatter', () => {
  const input = [
    '---',
    'title: Whiteboard',
    '---',
    '# Atlas rollout',
    '- [x] Ship staging',
    '- [ ] Email [Jane](https://example.com) with `plan.md`',
  ].join('\n')

  const lines = tokenizeMarkdown(input)

  assert({
    given: 'markdown with frontmatter, heading, done/open tasks, link, and inline code',
    should: 'assign semantic token kinds without dropping punctuation',
    actual: [lines[0], lines[1], lines[3], lines[4], lines[5]!.map((token) => `${token.kind}:${token.text}`)],
    expected: [
      [{ kind: 'punct', text: '---' }],
      [
        { kind: 'frontmatter-key', text: 'title' },
        { kind: 'punct', text: ':' },
        { kind: 'quote', text: ' Whiteboard' },
      ],
      [
        { kind: 'punct', text: '#' },
        { kind: 'plain', text: ' ' },
        { kind: 'heading', text: 'Atlas rollout' },
      ],
      [
        { kind: 'punct', text: '- ' },
        { kind: 'check-done', text: '[x]' },
        { kind: 'plain', text: ' ' },
        { kind: 'done-text', text: 'Ship staging' },
      ],
      [
        'punct:- ',
        'check-open:[ ]',
        'plain: Email ',
        'punct:[',
        'link-text:Jane',
        'punct:](',
        'link-url:https://example.com',
        'punct:)',
        'plain: with ',
        'punct:`',
        'code:plan.md',
        'punct:`',
      ],
    ],
  })
})
