import * as vscode from 'vscode'
import { isCursorInYamlFrontmatter } from '../util.ts'
import { CompletionDataStore } from './store/CompletionDataStore.ts'
import { filterByPrefix } from './utils/matching.ts'
import { createReplacementRange } from './utils/ranges.ts'

export default class DayItemCompletionProvider implements vscode.CompletionItemProvider {
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
    if (inFrontMatter) return

    const line = document.lineAt(position).text
    const linePrefix = line.substr(0, position.character)

    // Match day item pattern: - HH:MM(duration)? >
    // e.g., "- 10:30 > ", "- 14:15(60m) > ", "- 09:00(4h) > "
    const dayItemPattern = /^\s*-\s*\d{1,2}:\d{2}(\(\d+[mh]\))?\s*>\s*/
    if (!dayItemPattern.test(linePrefix)) return

    // Check if there's a "->" arrow (for person/context pattern)
    // Pattern: "- 10:30 > Bob In Person -> Tag: description"
    const hasArrow = linePrefix.includes(' -> ')

    let searchTerm: string
    let afterPattern: string

    if (hasArrow) {
      // After "->", extract text after arrow
      const arrowIndex = linePrefix.lastIndexOf(' -> ')
      afterPattern = linePrefix.substring(arrowIndex + 4) // +4 for " -> "
    } else {
      // After ">", extract text after day item pattern
      afterPattern = linePrefix.replace(dayItemPattern, '')
    }

    // Don't provide completions if we're already past the colon (in the description)
    if (afterPattern.includes(':')) return

    // Handle comma-separated entries - get text after the last comma
    const lastCommaIndex = afterPattern.lastIndexOf(',')
    if (lastCommaIndex !== -1) {
      afterPattern = afterPattern.substring(lastCommaIndex + 1)
    }

    searchTerm = afterPattern.trim()

    // Suggest tags, people, and organizations
    const allTags = this.store.getTags()
    const allPeople = this.store.getPeople()
    const allOrganizations = this.store.getOrganizations()

    // Exclude tags with prefixes handled by dedicated completion providers
    const filteredTags = allTags.filter((tag) => !tag.startsWith('projects/'))
    const matchingTags = filterByPrefix(filteredTags, searchTerm)
    const matchingPeople = filterByPrefix(allPeople, searchTerm)
    const matchingOrganizations = filterByPrefix(allOrganizations, searchTerm)

    const completions: vscode.CompletionItem[] = []

    // Add tag completions
    matchingTags.forEach((tag) => {
      const completionItem = new vscode.CompletionItem(tag)
      completionItem.kind = vscode.CompletionItemKind.Text
      completionItem.range = createReplacementRange(position, searchTerm.length)
      completions.push(completionItem)
    })

    // Add people completions
    matchingPeople.forEach((person) => {
      const completionItem = new vscode.CompletionItem(person)
      completionItem.kind = vscode.CompletionItemKind.User
      completionItem.range = createReplacementRange(position, searchTerm.length)
      completions.push(completionItem)
    })

    // Add organization completions
    matchingOrganizations.forEach((org) => {
      const completionItem = new vscode.CompletionItem(org)
      completionItem.kind = vscode.CompletionItemKind.Struct
      completionItem.range = createReplacementRange(position, searchTerm.length)
      completions.push(completionItem)
    })

    return completions
  }
}
