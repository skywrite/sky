import * as vscode from 'vscode'
import { isCursorInYamlFrontmatter } from '../util.ts'
import { isCursorInRelevantYamlKey } from '../util/mod.ts'
import { CompletionDataStore, type OrgWithScore } from './store/CompletionDataStore.ts'
import { createReplacementRange } from './utils/ranges.ts'
import { scoreSortText } from './utils/ranking.ts'

/** The slice of the completion store this provider needs. */
export interface OrganizationsSource {
  getOrganizationsWithScores(): OrgWithScore[]
}

/**
 * Provides organization name completions in YAML frontmatter.
 *
 * Organizations are scored exactly as people are — same interaction weights,
 * same recency decay — and both rank off that score, so in a shared field like
 * `rel:` an org you work with constantly outranks a person you barely mention.
 *
 * Completion icons (visual reference: https://microsoft.github.io/vscode-codicons/dist/codicon.html)
 * - Organizations: Struct (three-bar structure icon)
 * - People: User (person silhouette) - see PeopleCompletionItemProvider
 */
export default class OrganizationsCompletionItemProvider implements vscode.CompletionItemProvider {
  private source: OrganizationsSource

  // Defaults to the shared store. Tests pass a stub so assertions don't ride on
  // whatever the notebook service happens to hold.
  constructor(source: OrganizationsSource = CompletionDataStore.getInstance()) {
    this.source = source
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
    const searchLower = searchOrg.toLowerCase()

    const allOrgsWithScores = this.source.getOrganizationsWithScores()
    const matchingOrgs = allOrgsWithScores.filter((org) =>
      org.name.toLowerCase().startsWith(searchLower)
    )

    return matchingOrgs.map((org) => {
      const completionItem = new vscode.CompletionItem(org.name)
      completionItem.kind = vscode.CompletionItemKind.Struct
      completionItem.range = createReplacementRange(position, searchOrg.length)

      // Same key as people use, so the two interleave by score
      completionItem.sortText = scoreSortText(org.score)

      // Show score as detail for transparency
      if (org.score > 0) {
        completionItem.detail = `Score: ${org.score.toFixed(1)}`
      }

      return completionItem
    })
  }
}
