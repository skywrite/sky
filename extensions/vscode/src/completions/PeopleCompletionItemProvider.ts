import * as vscode from 'vscode'
import { isCursorInYamlFrontmatter } from '../util.ts'
import { isCursorInRelevantYamlKey } from '../util/mod.ts'
import { CompletionDataStore, type PersonWithScore } from './store/CompletionDataStore.ts'
import { createReplacementRange } from './utils/ranges.ts'

/** The slice of the completion store this provider needs. */
export interface PeopleSource {
  getPeopleWithScores(): PersonWithScore[]
}

/**
 * Provides person name completions in YAML frontmatter.
 * People are sorted by interaction score (meetings, emails, mentions)
 * with recency weighting - more recent and frequent interactions rank higher.
 */
export default class PeopleCompletionItemProvider implements vscode.CompletionItemProvider {
  private source: PeopleSource

  // Defaults to the shared store. Tests pass a stub so assertions don't ride on
  // whatever the notebook service happens to hold.
  constructor(source: PeopleSource = CompletionDataStore.getInstance()) {
    this.source = source
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext,
  ) {
    const inFrontMatter = isCursorInYamlFrontmatter(document, position)
    if (!inFrontMatter) return

    const relevantKeys = ['who', 'to', 'from', 'cc', 'bcc', 'rel', 'ib']
    const inRelevantYamlKey = isCursorInRelevantYamlKey(document, position, relevantKeys)
    if (!inRelevantYamlKey) return

    const line = document.lineAt(position).text
    const linePrefix = line.substr(0, position.character)

    let people: string[] = []

    if (linePrefix.trim().startsWith('-')) {
      // In array context, strip the leading '-' and trim the result
      people = [linePrefix.replace('-', '').trim()]
    } else {
      // Extract the current people entries based on delimiters (; or ,)
      people = linePrefix.replace(/^[^:]+:/, '') // Remove the key part (e.g., "who:")
        .split(/[,;]/) // Split by either comma or semicolon
        .map((p) => p.trim())
        .filter((p) => p)
    }

    const searchPerson = people.at(-1) || ''
    const searchLower = searchPerson.toLowerCase()

    // Get people with scores and filter by prefix
    const allPeopleWithScores = this.source.getPeopleWithScores()
    const matchingPeople = allPeopleWithScores.filter((p) =>
      p.name.toLowerCase().startsWith(searchLower)
    )

    // Create completion items with score-based sorting
    return matchingPeople.map((person, index) => {
      const completionItem = new vscode.CompletionItem(person.name)
      completionItem.kind = vscode.CompletionItemKind.User
      completionItem.range = createReplacementRange(position, searchPerson.length)

      // Use sortText to preserve server-side score ordering
      // Pad index to ensure proper string sorting (00001, 00002, etc.)
      completionItem.sortText = String(index).padStart(5, '0')

      // Show score as detail for transparency
      if (person.score > 0) {
        completionItem.detail = `Score: ${person.score.toFixed(1)}`
      }

      return completionItem
    })
  }
}
