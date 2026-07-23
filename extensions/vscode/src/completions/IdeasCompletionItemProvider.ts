import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_IDEAS } from '#config'

/**
 * Provides completion for ideas when user types `ideas/`.
 *
 * Shows all idea slugs flattened (regardless of year/month structure).
 * The slug maps to the full path: ideas/{slug} -> ideas/{year}/{status}/{month}/{slug}.md
 */
export default class IdeasCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
    const linePrefix = document.lineAt(position).text.substr(0, position.character)

    const searchStr = 'ideas/'

    if (!linePrefix.includes(searchStr)) return

    const searchPos = linePrefix.indexOf(searchStr)
    const afterTrigger = linePrefix.slice(searchPos + searchStr.length)

    // If there's already a slash after ideas/, don't provide completions
    if (afterTrigger.includes('/')) return

    const ideas = await this.findAllIdeas()

    const filtered = ideas.filter((d) => d.slug.toLowerCase().startsWith(afterTrigger.toLowerCase()))

    return filtered.map((idea) => {
      const item = new vscode.CompletionItem(idea.slug)
      item.kind = vscode.CompletionItemKind.Event
      item.detail = `ideas/${idea.year}/${idea.status}/${idea.month}/${idea.slug}`
      item.insertText = idea.slug
      item.range = new vscode.Range(
        position.translate(0, -afterTrigger.length),
        position,
      )
      return item
    })
  }

  private async findAllIdeas(): Promise<Array<{ slug: string; year: string; status: string; month: string }>> {
    const ideas: Array<{ slug: string; year: string; status: string; month: string }> = []

    try {
      const years = await fs.readdir(DIR_IDEAS, { withFileTypes: true })

      for (const yearEntry of years) {
        if (!yearEntry.isDirectory() || yearEntry.name.startsWith('.')) continue

        const yearPath = path.join(DIR_IDEAS, yearEntry.name)
        const statuses = await fs.readdir(yearPath, { withFileTypes: true })

        for (const statusEntry of statuses) {
          if (!statusEntry.isDirectory() || statusEntry.name.startsWith('.')) continue

          const statusPath = path.join(yearPath, statusEntry.name)
          const months = await fs.readdir(statusPath, { withFileTypes: true })

          for (const monthEntry of months) {
            if (!monthEntry.isDirectory() || monthEntry.name.startsWith('.')) continue

            const monthPath = path.join(statusPath, monthEntry.name)
            const files = await fs.readdir(monthPath, { withFileTypes: true })

            for (const file of files) {
              if (!file.isFile()) continue
              if (!file.name.endsWith('.md')) continue
              if (file.name.startsWith('.')) continue

              const slug = path.parse(file.name).name
              ideas.push({
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

    ideas.sort((a, b) => a.slug.localeCompare(b.slug))

    return ideas
  }
}
