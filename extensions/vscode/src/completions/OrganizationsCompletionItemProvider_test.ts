import * as vscode from 'vscode'
import { assert as assertEqual } from '#shared/test/riteway.ts'
import OrganizationsCompletionItemProvider from './OrganizationsCompletionItemProvider.ts'
import PeopleCompletionItemProvider from './PeopleCompletionItemProvider.ts'

/**
 * Organizations are scored on the same scale as people, and both providers key
 * their sortText off that score, so the two interleave in a shared field like
 * `rel:` instead of people always sitting on top.
 */

// The store hands these over pre-sorted, score descending.
const ORGS = [
  { name: 'Atlas', score: 200 },
  { name: 'Acme', score: 5 },
  { name: 'Borealis', score: 0 },
]

const provider = new OrganizationsCompletionItemProvider({ getOrganizationsWithScores: () => ORGS })

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

  return provider.provideCompletionItems(
    document,
    position,
    new vscode.CancellationTokenSource().token,
    { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined },
  )
}

function summarize(items: vscode.CompletionItem[] | undefined): Summary[] | 'no completions' {
  if (!items) return 'no completions'
  return items.map((item) => ({
    label: item.label as string,
    sortText: item.sortText,
    detail: item.detail,
  }))
}

test('OrganizationsCompletionItemProvider - ordering, filtering and score detail', async () => {
  const fixtures = [
    {
      given: 'an empty org field',
      lines: ['---', 'org: ', '---', ''],
      line: 1,
      expected: [
        { label: 'Atlas', sortText: '997999', detail: 'Score: 200.0' },
        { label: 'Acme', sortText: '999949', detail: 'Score: 5.0' },
        { label: 'Borealis', sortText: '999999', detail: undefined },
      ],
      should: 'offer every org in store order, with a score on all but the unscored',
    },
    {
      given: 'a partial org name',
      lines: ['---', 'org: A', '---', ''],
      line: 1,
      expected: [
        { label: 'Atlas', sortText: '997999', detail: 'Score: 200.0' },
        { label: 'Acme', sortText: '999949', detail: 'Score: 5.0' },
      ],
      should: 'filter by prefix, case-insensitively, keeping each score key',
    },
    {
      given: 'a second entry after a semicolon',
      lines: ['---', 'orgs: Acme; B', '---', ''],
      line: 1,
      expected: [{ label: 'Borealis', sortText: '999999', detail: undefined }],
      should: 'complete the entry being typed',
    },
    {
      given: 'a YAML array item',
      lines: ['---', 'orgs:', '  - Acme', '  - B', '---', ''],
      line: 3,
      expected: [{ label: 'Borealis', sortText: '999999', detail: undefined }],
      should: 'complete inside the list item',
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

test('OrganizationsCompletionItemProvider - where it fires', async () => {
  // `current` and `past` are nested under `orgs` on Person documents.
  const fields = ['org', 'orgs', 'current', 'past', 'rel']

  for (const field of fields) {
    assertEqual({
      given: `the ${field} field`,
      should: 'offer orgs',
      actual: summarize(await completions(['---', `${field}: Ac`, '---', ''], 1)),
      expected: [{ label: 'Acme', sortText: '999949', detail: 'Score: 5.0' }],
    })
  }

  assertEqual({
    given: 'an unrelated frontmatter key',
    should: 'not offer orgs',
    actual: summarize(await completions(['---', 'who: Ac', '---', ''], 1)),
    expected: 'no completions',
  })

  assertEqual({
    given: 'an org field below the frontmatter',
    should: 'not offer orgs',
    actual: summarize(await completions(['---', 'org: Acme', '---', '', 'org: Ac'], 4)),
    expected: 'no completions',
  })
})

test('rel: a high-scoring org outranks a lower-scoring person', async () => {
  // Typing `Ro` where an org you work with constantly and a person you barely
  // mention both match. The two come from separate providers; VS Code merges
  // their items and orders by sortText among equally-good prefix matches, so
  // the org has to win on the key alone.
  const lines = ['---', 'rel: Ro', '---', '']

  const document = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown',
  })
  const position = new vscode.Position(1, document.lineAt(1).text.length)
  const token = new vscode.CancellationTokenSource().token
  const context = { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined }

  const orgs = new OrganizationsCompletionItemProvider({
    getOrganizationsWithScores: () => [{ name: 'Rotunda Labs', score: 180 }],
  })
  const people = new PeopleCompletionItemProvider({
    getPeopleWithScores: () => [{ name: 'Rosa Lee', score: 4 }],
  })

  const merged = [
    ...(orgs.provideCompletionItems(document, position, token, context) ?? []),
    ...(people.provideCompletionItems(document, position, token, context) ?? []),
  ]

  assertEqual({
    given: 'an org and a person both matching the typed prefix',
    should: 'sort the higher-scoring org first, across provider boundaries',
    actual: merged
      .toSorted((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''))
      .map((item) => `${item.label} (${item.sortText})`),
    expected: ['Rotunda Labs (998199)', 'Rosa Lee (999959)'],
  })

  assertEqual({
    given: 'the same two items',
    should: 'both carry a score detail, so the ranking is legible in the list',
    actual: merged.map((item) => item.detail),
    expected: ['Score: 180.0', 'Score: 4.0'],
  })
})
