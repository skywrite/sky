import * as vscode from 'vscode'
import { isCursorInYamlFrontmatter } from '../util.ts'
import { isCursorInRelevantYamlKey } from '../util/mod.ts'
import { CompletionDataStore } from './store/CompletionDataStore.ts'
import { filterByPrefix } from './utils/matching.ts'
import { createReplacementRange } from './utils/ranges.ts'

/**
 * Provides organization name completions in YAML frontmatter.
 *
 * Completion icons (visual reference: https://microsoft.github.io/vscode-codicons/dist/codicon.html)
 * - Organizations: Struct (three-bar structure icon)
 * - People: User (person silhouette) - see PeopleCompletionItemProvider
 */
export default class OrganizationsCompletionItemProvider implements vscode.CompletionItemProvider {
  private store: CompletionDataStore

  constructor() {
    this.store = CompletionDataStore.getInstance()
  }
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ) {
    const inFrontMatter = isCursorInYamlFrontmatter(document, position)
    if (!inFrontMatter) return

    // 'current' and 'past' are nested under 'orgs' for Person documents
    const relevantKeys = ['org', 'orgs', 'current', 'past', 'rel']
    const inRelevantYamlKey = isCursorInRelevantYamlKey(document, position, relevantKeys)
    if (!inRelevantYamlKey) return

    const line = document.lineAt(position).text
    const linePrefix = line.substr(0, position.character)

    let orgs: string[] = []

    if (linePrefix.trim().startsWith('-')) {
      // In array context, strip the leading '-' and trim the result
      orgs = [linePrefix.replace('-', '').trim()]
    } else {
      // Extract the current org entries based on delimiters (; or ,)
      orgs = linePrefix.replace(/^[^:]+:/, '') // Remove the key part (e.g., "org:")
        .split(/[,;]/) // Split by either comma or semicolon
        .map((o) => o.trim())
        .filter((o) => o)
    }

    const searchOrg = orgs.at(-1) || ''

    const allOrgs = this.store.getOrganizations()
    const matchingOrgs = filterByPrefix(allOrgs, searchOrg)

    return matchingOrgs.map((org) => {
      const completionItem = new vscode.CompletionItem(org)
      completionItem.kind = vscode.CompletionItemKind.Struct
      completionItem.range = createReplacementRange(position, searchOrg.length)

      return completionItem
    })
  }
}
