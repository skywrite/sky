import * as vscode from 'vscode'
import { assert as assertEqual } from '#shared/test/riteway.ts'
import TagsCompletionItemProvider from './TagsCompletionItemProvider.ts'

/**
 * Characterization tests describing what the tag provider does *today*.
 *
 * Tags differ from people and orgs in three ways that are easy to erase by
 * accident when the three providers are folded together: the key check is
 * `line.startsWith('tags:')` rather than a trimmed, section-aware one; the
 * only separator is `;`; and the entry being completed is taken from the whole
 * line rather than the text before the cursor. The last of those is a defect —
 * see the final test — but it is pinned here as-is so a restructuring doesn't
 * silently change behavior while claiming to preserve it.
 */

const TAGS = [
  { name: 'atlas', score: 76.8 },
  { name: 'ops', score: 3 },
  { name: 'zzz', score: 0 },
]

const provider = new TagsCompletionItemProvider({ getTagsWithScores: () => TAGS })

interface Summary {
  label: string
  sortText: string | undefined
  detail: string | undefined
}

async function completions(
  lines: string[],
  line: number,
  character?: number,
): Promise<vscode.CompletionItem[] | undefined> {
  const document = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown',
  })
  const position = new vscode.Position(line, character ?? document.lineAt(line).text.length)

  return provider.provideCompletionItems(document, position, new vscode.CancellationTokenSource().token, {
    triggerKind: vscode.CompletionTriggerKind.Invoke,
    triggerCharacter: undefined,
  })
}

function summarize(items: vscode.CompletionItem[] | undefined): Summary[] | 'no completions' {
  if (!items) return 'no completions'
  return items.map((item) => ({
    label: item.label as string,
    sortText: item.sortText,
    detail: item.detail,
  }))
}

test('TagsCompletionItemProvider - ordering, filtering and score detail', async () => {
  const fixtures = [
    {
      given: 'an empty tags field',
      lines: ['---', 'tags: ', '---', ''],
      line: 1,
      expected: [
        { label: 'atlas', sortText: '00000', detail: 'Score: 76.8' },
        { label: 'ops', sortText: '00001', detail: 'Score: 3.0' },
        { label: 'zzz', sortText: '00002', detail: undefined },
      ],
      should: 'offer every tag in store order, with a score on all but the unscored',
    },
    {
      given: 'a partial tag',
      lines: ['---', 'tags: at', '---', ''],
      line: 1,
      expected: [{ label: 'atlas', sortText: '00000', detail: 'Score: 76.8' }],
      should: 'filter by prefix',
    },
    {
      given: 'a second tag after a semicolon',
      lines: ['---', 'tags: atlas; op', '---', ''],
      line: 1,
      expected: [{ label: 'ops', sortText: '00000', detail: 'Score: 3.0' }],
      should: 'complete the tag being typed',
    },
    {
      given: 'a second tag after a comma',
      lines: ['---', 'tags: atlas, op', '---', ''],
      line: 1,
      expected: [],
      should: 'match nothing — unlike people and orgs, a comma is not a separator here',
    },
  ]

  for (const { given, lines, line, expected, should } of fixtures) {
    assertEqual({
      given,
      should,
      actual: summarize(await completions(lines, line)),
      expected,
    })
  }
})

test('TagsCompletionItemProvider - where it fires', async () => {
  const fixtures = [
    {
      given: 'an indented tags key',
      lines: ['---', '  tags: at', '---', ''],
      line: 1,
      expected: 'no completions' as const,
      should: 'not fire — the key check is not trimmed',
    },
    {
      given: 'a YAML array item under tags',
      lines: ['---', 'tags:', '  - at', '---', ''],
      line: 2,
      expected: 'no completions' as const,
      should: 'not fire — there is no array-item handling',
    },
    {
      given: 'a tags line below the frontmatter',
      lines: ['---', 'tags: atlas', '---', '', 'tags: at'],
      line: 4,
      expected: 'no completions' as const,
      should: 'not fire outside the frontmatter',
    },
  ]

  for (const { given, lines, line, expected, should } of fixtures) {
    assertEqual({
      given,
      should,
      actual: summarize(await completions(lines, line)),
      expected,
    })
  }
})

test('TagsCompletionItemProvider - a mid-line cursor completes the wrong entry', async () => {
  // `tags: at; op` with the cursor just after `at`. The provider splits the
  // whole line rather than the text before the cursor, so it completes `op`
  // — and then computes the replacement range backwards from the cursor using
  // that entry's length, which lands on `at`. Accepting a suggestion here
  // rewrites the entry the cursor is not in.
  const lines = ['---', 'tags: at; op', '---', '']
  const cursor = 8

  const items = await completions(lines, 1, cursor)

  assertEqual({
    given: 'a cursor in the first of two tags',
    should: 'complete the *last* tag on the line instead of the one being typed',
    actual: summarize(items),
    expected: [{ label: 'ops', sortText: '00000', detail: 'Score: 3.0' }],
  })

  const range = items?.[0]?.range as vscode.Range
  assertEqual({
    given: 'the replacement range for that suggestion',
    should: 'cover `at`, the text the cursor is actually in',
    actual: [range.start.character, range.end.character],
    expected: [6, 8],
  })
})
