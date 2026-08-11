import * as vscode from 'vscode'
import { assert as assertEqual } from '#shared/test/riteway.ts'
import PeopleCompletionItemProvider from './PeopleCompletionItemProvider.ts'

/**
 * Characterization tests, written ahead of restructuring the frontmatter
 * completion providers. They describe what the provider does *today* — not
 * what it ought to do — so that a restructuring that changes any of it fails
 * loudly instead of quietly.
 */

// The store hands these over pre-sorted (score descending, name ascending on
// ties); the provider's job is to preserve that order through VS Code.
const PEOPLE = [
  { name: 'Jane Doe', score: 30 },
  { name: 'John Roe', score: 20.5 },
  { name: 'Jane Roe', score: 10 },
  { name: 'Ada Byron', score: 0 },
]

const provider = new PeopleCompletionItemProvider({ getPeopleWithScores: () => PEOPLE })

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

test('PeopleCompletionItemProvider - ordering, filtering and score detail', async () => {
  const fixtures = [
    {
      given: 'an empty person field',
      lines: ['---', 'who: ', '---', ''],
      line: 1,
      expected: [
        { label: 'Jane Doe', sortText: '999699', detail: 'Score: 30.0' },
        { label: 'John Roe', sortText: '999794', detail: 'Score: 20.5' },
        { label: 'Jane Roe', sortText: '999899', detail: 'Score: 10.0' },
        { label: 'Ada Byron', sortText: '999999', detail: undefined },
      ],
      should: 'offer everyone in store order, with a score on all but the unscored',
    },
    {
      given: 'a partial name',
      lines: ['---', 'who: Jane', '---', ''],
      line: 1,
      expected: [
        { label: 'Jane Doe', sortText: '999699', detail: 'Score: 30.0' },
        { label: 'Jane Roe', sortText: '999899', detail: 'Score: 10.0' },
      ],
      should: 'filter by prefix, each keeping the sortText its own score earned',
    },
    {
      given: 'a lowercase partial name',
      lines: ['---', 'who: jane d', '---', ''],
      line: 1,
      expected: [{ label: 'Jane Doe', sortText: '999699', detail: 'Score: 30.0' }],
      should: 'match case-insensitively across the space',
    },
    {
      given: 'a second entry after a semicolon',
      lines: ['---', 'who: Jane Doe; Jo', '---', ''],
      line: 1,
      expected: [{ label: 'John Roe', sortText: '999794', detail: 'Score: 20.5' }],
      should: 'complete the entry being typed, not the whole field',
    },
    {
      given: 'a second entry after a comma',
      lines: ['---', 'who: Jane Doe, Jo', '---', ''],
      line: 1,
      expected: [{ label: 'John Roe', sortText: '999794', detail: 'Score: 20.5' }],
      should: 'treat the comma as a separator too',
    },
    {
      given: 'a YAML array item',
      lines: ['---', 'who:', '  - Jane Doe', '  - Jo', '---', ''],
      line: 3,
      expected: [{ label: 'John Roe', sortText: '999794', detail: 'Score: 20.5' }],
      should: 'complete inside the list item',
    },
    {
      given: 'a prefix matching nobody',
      lines: ['---', 'who: Zed', '---', ''],
      line: 1,
      expected: [],
      should: 'return an empty list rather than bailing',
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

test('PeopleCompletionItemProvider - where it fires', async () => {
  const fields = ['who', 'to', 'from', 'cc', 'bcc', 'rel', 'ib']

  for (const field of fields) {
    assertEqual({
      given: `the ${field} field`,
      should: 'offer people',
      actual: summarize(await completions(['---', `${field}: Jane D`, '---', ''], 1)),
      expected: [{ label: 'Jane Doe', sortText: '999699', detail: 'Score: 30.0' }],
    })
  }

  assertEqual({
    given: 'an unrelated frontmatter key',
    should: 'not offer people',
    actual: summarize(await completions(['---', 'tags: Jane D', '---', ''], 1)),
    expected: 'no completions',
  })

  assertEqual({
    given: 'a person field below the frontmatter',
    should: 'not offer people',
    actual: summarize(await completions(['---', 'who: Jane Doe', '---', '', 'who: Jane D'], 4)),
    expected: 'no completions',
  })

  assertEqual({
    given: 'a document with no frontmatter at all',
    should: 'not offer people',
    actual: summarize(await completions(['who: Jane D', ''], 0)),
    expected: 'no completions',
  })
})

test('PeopleCompletionItemProvider - replaces the typed term', async () => {
  const fixtures = [
    {
      given: 'a partially typed name',
      lines: ['---', 'who: Jane', '---', ''],
      line: 1,
      expected: [
        [5, 9],
        [5, 9],
      ],
      should: 'replace the four typed characters',
    },
    {
      given: 'an empty field',
      lines: ['---', 'who: ', '---', ''],
      line: 1,
      expected: [
        [5, 5],
        [5, 5],
        [5, 5],
        [5, 5],
      ],
      should: 'insert at the cursor without replacing anything',
    },
  ]

  for (const { given, lines, line, expected, should } of fixtures) {
    const items = await completions(lines, line)
    const ranges = (items ?? []).map((item) => {
      const range = item.range as vscode.Range
      return [range.start.character, range.end.character]
    })

    assertEqual({ given, should, actual: ranges, expected })
  }
})
