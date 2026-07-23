import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_DECISIONS } from '#config'

/**
 * Provides completion for decisions when user types `decisions/`.
 *
 * Shows all decision slugs flattened (regardless of year/month structure).
 * The slug maps to the full path: decisions/{slug} -> decisions/{year}/{month}/{slug}.md
 */
export default class DecisionsCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
    const linePrefix = document.lineAt(position).text.substr(0, position.character)

    const searchStr = 'decisions/'

    if (!linePrefix.includes(searchStr)) return

    const searchPos = linePrefix.indexOf(searchStr)
    const afterTrigger = linePrefix.slice(searchPos + searchStr.length)

    // If there's already a slash after decisions/, don't provide completions
    // (user is typing a full path, not using the shorthand)
    if (afterTrigger.includes('/')) return

    // Find all decision files across all years/months
    const decisions = await this.findAllDecisions()

    // Filter by what user has typed so far
    const filtered = decisions.filter((d) => d.slug.toLowerCase().startsWith(afterTrigger.toLowerCase()))

    return filtered.map((decision) => {
      const item = new vscode.CompletionItem(decision.slug)
      item.kind = vscode.CompletionItemKind.Event
      item.detail = `decisions/${decision.year}/${decision.status}/${decision.month}/${decision.slug}`
      item.insertText = decision.slug
      item.range = new vscode.Range(
        position.translate(0, -afterTrigger.length),
        position
      )
      return item
    })
  }

  private async findAllDecisions(): Promise<Array<{ slug: string; year: string; status: string; month: string }>> {
    const decisions: Array<{ slug: string; year: string; status: string; month: string }> = []
    const validStatuses = ['pending', 'resolved']

    try {
      // Read year directories
      const years = await fs.readdir(DIR_DECISIONS, { withFileTypes: true })

      for (const yearEntry of years) {
        if (!yearEntry.isDirectory() || yearEntry.name.startsWith('.')) continue

        const yearPath = path.join(DIR_DECISIONS, yearEntry.name)

        // Read status directories (pending, resolved - not archived)
        const statuses = await fs.readdir(yearPath, { withFileTypes: true })

        for (const statusEntry of statuses) {
          if (!statusEntry.isDirectory()) continue
          if (!validStatuses.includes(statusEntry.name)) continue

          const statusPath = path.join(yearPath, statusEntry.name)

          // Read month directories
          const months = await fs.readdir(statusPath, { withFileTypes: true })

          for (const monthEntry of months) {
            if (!monthEntry.isDirectory() || monthEntry.name.startsWith('.')) continue

            const monthPath = path.join(statusPath, monthEntry.name)

            // Read decision files
            const files = await fs.readdir(monthPath, { withFileTypes: true })

            for (const file of files) {
              // Skip non-markdown, hidden files, and index files
              if (!file.isFile()) continue
              if (!file.name.endsWith('.md')) continue
              if (file.name.startsWith('.')) continue
              if (file.name === 'decisions.md') continue

              const slug = path.parse(file.name).name
              decisions.push({
                slug,
                year: yearEntry.name,
                status: statusEntry.name,
                month: monthEntry.name,
              })
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    // Sort alphabetically by slug
    decisions.sort((a, b) => a.slug.localeCompare(b.slug))

    return decisions
  }
}
