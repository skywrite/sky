import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_PROJECTS_OPEN } from '#config'

const rootPath = DIR_PROJECTS_OPEN

export default class ProjectsCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
    const linePrefix = document.lineAt(position).text.substr(0, position.character)

    const searchStr = 'projects/'

    if (!linePrefix.includes(searchStr)) return

    const searchPos = linePrefix.indexOf(searchStr)
    const afterTrigger = linePrefix.slice(searchPos + searchStr.length)

    // Projects are flat (no subdirectories) — if there's a slash, bail out
    if (afterTrigger.includes('/')) return

    let dirEntries
    try {
      dirEntries = await fs.readdir(rootPath, { withFileTypes: true })
    } catch {
      return
    }

    return dirEntries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => {
        const name = entry.name
        const item = new vscode.CompletionItem(name)
        item.kind = vscode.CompletionItemKind.Folder
        item.detail = 'Open project'
        item.filterText = 'projects/' + name
        item.sortText = '!' + name // rank above word completions
        item.insertText = name
        item.range = new vscode.Range(
          position.translate(0, -afterTrigger.length),
          position,
        )
        return item
      })
  }
}
