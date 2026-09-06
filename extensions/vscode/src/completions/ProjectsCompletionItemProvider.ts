import * as vscode from 'vscode'
import { DIR_PROJECTS_OPEN } from '#config'
import openProjectNames from '#shared/nbfs/openProjectNames.ts'

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

    const names = await openProjectNames(rootPath)
    return names.map((name) => {
      const item = new vscode.CompletionItem(name)
      item.kind = vscode.CompletionItemKind.Folder
      item.detail = 'Open project'
      item.filterText = 'projects/' + name
      item.sortText = '!' + name // rank above word completions
      item.insertText = name
      item.range = new vscode.Range(position.translate(0, -afterTrigger.length), position)
      return item
    })
  }
}
