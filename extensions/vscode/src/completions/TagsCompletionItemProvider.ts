import * as vscode from 'vscode'
import { isCursorInYamlFrontmatter } from '../util.ts'
import { CompletionDataStore, type TagWithScore } from './store/CompletionDataStore.ts'
import { createReplacementRange } from './utils/ranges.ts'

/** The slice of the completion store this provider needs. */
export interface TagsSource {
  getTagsWithScores(): TagWithScore[]
}

/**
 * Provides tag completions in YAML frontmatter.
 * Tags are sorted by usage score (frequency + recency weighting) —
 * more recently and frequently used tags rank higher.
 */
export default class TagsCompletionItemProvider implements vscode.CompletionItemProvider {
  private source: TagsSource

  // Defaults to the shared store. Tests pass a stub so assertions don't ride on
  // whatever the notebook service happens to hold.
  constructor(source: TagsSource = CompletionDataStore.getInstance()) {
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

    const line = document.lineAt(position).text

    if (!line.startsWith('tags:')) return

    const tags = line.replace('tags:', '')
      .split(';')
      .map((t) => t.trim())
      .filter((t) => t)

    const searchTag = tags.at(-1) || ''
    const searchLower = searchTag.toLowerCase()

    const allTagsWithScores = this.source.getTagsWithScores()
    const matchingTags = allTagsWithScores.filter((t) =>
      t.name.toLowerCase().startsWith(searchLower)
    )

    return matchingTags.map((tag, index) => {
      const completionItem = new vscode.CompletionItem(tag.name)
      completionItem.kind = vscode.CompletionItemKind.Text
      completionItem.range = createReplacementRange(position, searchTag.length)

      // Preserve server-side score ordering
      completionItem.sortText = String(index).padStart(5, '0')

      if (tag.score > 0) {
        completionItem.detail = `Score: ${tag.score.toFixed(1)}`
      }

      return completionItem
    })
  }
}
