import { Dirent } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { DIR_LIBRARY } from '#config'

const rootPath = DIR_LIBRARY

export default class LibraryCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
    const linePrefix = document.lineAt(position).text.substr(0, position.character)

    const searchStr = 'library/'

    if (!linePrefix.includes(searchStr)) return

    const searchPos = linePrefix.indexOf(searchStr)
    const placePath = linePrefix.replace(linePrefix.slice(0, searchPos + searchStr.length), '')

    const currentPath = path.join(rootPath, placePath)
    let dirEntries: Dirent[]
    try {
      dirEntries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch (e) {
      return
    }

    return dirEntries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => {
        const name = path.parse(entry.name).name // chop off file extension (noop for dirs)
        const item = new vscode.CompletionItem(name)
        item.range = new vscode.Range(position, position)

        if (entry.isDirectory()) {
          item.insertText = `${name}/`
          item.command = {
            command: 'editor.action.triggerSuggest',
            title: 'Trigger Suggest',
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          item.insertText = name
        }

        return item
      })
  }
}
