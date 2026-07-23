import * as vscode from 'vscode'
import { filterByPrefix } from './utils/matching.ts'
import { createReplacementRange } from './utils/ranges.ts'
import { patterns } from '#universal/dates/recurring/patterns.ts'

/** All supported recurring patterns with descriptions */
const RECURRING_PATTERNS = patterns

/**
 * Provides completion suggestions for recurring task patterns in recurring-*.md files.
 * Triggers on level 2 headings (## ) to suggest valid pattern names.
 */
export default class RecurringPatternCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    // Only activate in files that use recurring patterns (recurring-*.md, reminders.md)
    const fileName = document.fileName.toLowerCase()
    if (!fileName.includes('recurring') && !fileName.includes('reminders')) return

    const line = document.lineAt(position).text
    const linePrefix = line.substring(0, position.character)

    // Check if we're typing after "## " (level 2 heading)
    if (!linePrefix.startsWith('## ')) return

    // Get the search term (text after "## ")
    const searchTerm = linePrefix.substring(3)

    // Filter patterns by prefix
    const patternNames = RECURRING_PATTERNS.map((p) => p.pattern)
    const matchingPatterns = filterByPrefix(patternNames, searchTerm)

    return matchingPatterns.map((pattern) => {
      const patternInfo = RECURRING_PATTERNS.find((p) => p.pattern === pattern)
      const completionItem = new vscode.CompletionItem(pattern)
      completionItem.kind = vscode.CompletionItemKind.Constant
      completionItem.detail = patternInfo?.description
      completionItem.range = createReplacementRange(position, searchTerm.length)

      return completionItem
    })
  }
}
