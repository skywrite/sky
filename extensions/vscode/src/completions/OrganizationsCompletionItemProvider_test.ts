import * as vscode from 'vscode'
import { assert as assertEqual } from '#shared/test/riteway.ts'
import OrganizationsCompletionItemProvider from './OrganizationsCompletionItemProvider.ts'
import PeopleCompletionItemProvider from './PeopleCompletionItemProvider.ts'

/**
 * Characterization tests describing what the org provider does *today*.
 *
 * Today it is fed the plain organization list, which arrives alphabetical and
 * carries no ranking signal — so org completions get neither a sortText nor a
 * score detail, while people in the very same `rel:` list get both. The last
 * test pins that asymmetry deliberately: it is the behavior a later change is
 * meant to remove, and pinning it here makes that change visible as an edited
 * expectation rather than a silent drift.
 */

const ORGS = ['Acme', 'Atlas', 'Borealis']

const provider = new OrganizationsCompletionItemProvider({ getOrganizations: () => ORGS })

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

test('OrganizationsCompletionItemProvider - ordering and filtering', async () => {
  const fixtures = [
    {
      given: 'an empty org field',
      lines: ['---', 'org: ', '---', ''],
      line: 1,
      expected: [
        { label: 'Acme', sortText: undefined, detail: undefined },
        { label: 'Atlas', sortText: undefined, detail: undefined },
        { label: 'Borealis', sortText: undefined, detail: undefined },
      ],
      should: 'offer every org in list order, with no ranking signal attached',
    },
    {
      given: 'a partial org name',
      lines: ['---', 'org: A', '---', ''],
      line: 1,
      expected: [
        { label: 'Acme', sortText: undefined, detail: undefined },
        { label: 'Atlas', sortText: undefined, detail: undefined },
      ],
      should: 'filter by prefix, case-insensitively',
    },
    {
      given: 'a second entry after a semicolon',
      lines: ['---', 'orgs: Acme; B', '---', ''],
      line: 1,
      expected: [{ label: 'Borealis', sortText: undefined, detail: undefined }],
      should: 'complete the entry being typed',
    },
    {
      given: 'a YAML array item',
      lines: ['---', 'orgs:', '  - Acme', '  - B', '---', ''],
      line: 3,
      expected: [{ label: 'Borealis', sortText: undefined, detail: undefined }],
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
      expected: [{ label: 'Acme', sortText: undefined, detail: undefined }],
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

test('rel: ranking signals — people carry them, orgs do not', async () => {
  const lines = ['---', 'rel: ', '---', '']

  const document = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown',
  })
  const position = new vscode.Position(1, document.lineAt(1).text.length)
  const token = new vscode.CancellationTokenSource().token
  const context = { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined }

  const people = new PeopleCompletionItemProvider({
    getPeopleWithScores: () => [{ name: 'Jane Doe', score: 30 }],
  })

  assertEqual({
    given: 'a person offered in rel:',
    should: 'carry a sortText and a score detail',
    actual: summarize(people.provideCompletionItems(document, position, token, context)),
    expected: [{ label: 'Jane Doe', sortText: '00000', detail: 'Score: 30.0' }],
  })

  assertEqual({
    given: 'an org offered in the same rel: field',
    should: 'carry neither, so VS Code falls back to sorting it by label',
    actual: summarize(provider.provideCompletionItems(document, position, token, context)),
    expected: [
      { label: 'Acme', sortText: undefined, detail: undefined },
      { label: 'Atlas', sortText: undefined, detail: undefined },
      { label: 'Borealis', sortText: undefined, detail: undefined },
    ],
  })
})
