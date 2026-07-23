import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { isCursorInYamlFrontmatter } from '../util.ts'

export default class CurrentDirCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ) {
    const inFrontMatter = isCursorInYamlFrontmatter(document, position)
    if (!inFrontMatter) return

    const linePrefix = document.lineAt(position).text.substr(0, position.character)

    if (!linePrefix.endsWith('./')) return

    const dirPath = path.dirname(document.fileName)
    const files = await fs.readdir(dirPath)

    return files.map((file) => {
      const fileNoExt = path.parse(file).name
      const item = new vscode.CompletionItem(fileNoExt, vscode.CompletionItemKind.File)
      item.insertText = fileNoExt
      return item
    })
  }
}
