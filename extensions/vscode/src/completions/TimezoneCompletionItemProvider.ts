import * as vscode from 'vscode'
import { isCursorInYamlFrontmatter } from '../util.ts'
import { isCursorInRelevantYamlKey } from '../util/mod.ts'
import { filterByPrefix } from './utils/matching.ts'
import { createReplacementRange } from './utils/ranges.ts'

// Get all IANA timezone identifiers
const IANA_TIMEZONES: string[] = Intl.supportedValuesOf('timeZone')

export default class TimezoneCompletionItemProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ) {
    const inFrontMatter = isCursorInYamlFrontmatter(document, position)
    if (!inFrontMatter) return

    const relevantKeys = ['tz']
    const inRelevantYamlKey = isCursorInRelevantYamlKey(document, position, relevantKeys)
    if (!inRelevantYamlKey) return

    const line = document.lineAt(position).text
    const linePrefix = line.substr(0, position.character)

    // Extract search term after the key (e.g., "tz: America/L" -> "America/L")
    const searchTerm = linePrefix.replace(/^[^:]+:\s*/, '').trim()

    const matchingTimezones = filterByPrefix(IANA_TIMEZONES, searchTerm)

    return matchingTimezones.map((timezone) => {
      const completionItem = new vscode.CompletionItem(timezone)
      completionItem.kind = vscode.CompletionItemKind.Value
      completionItem.range = createReplacementRange(position, searchTerm.length)

      return completionItem
    })
  }
}
