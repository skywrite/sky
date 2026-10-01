import { Dirent } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { DIR_PLACES_LOCATIONS } from '#config'

const rootPath = DIR_PLACES_LOCATIONS

export default class PlacesCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
    const linePrefix = document.lineAt(position).text.substr(0, position.character)

    const searchStr = 'places/'

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
      .filter(
        (entry) =>
          !entry.name.startsWith('.') && (entry.isDirectory() || (entry.isFile() && entry.name.endsWith('.md'))),
      )
      .map((entry) => {
        const isDirectory = entry.isDirectory()
        const name = isDirectory ? entry.name : path.parse(entry.name).name
        const label = isDirectory ? `${name}/` : name
        const kind = isDirectory ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
        const item = new vscode.CompletionItem(label, kind)
        item.detail = isDirectory ? 'Browse places' : 'Place link'
        item.range = new vscode.Range(position, position)
        item.insertText = label

        if (isDirectory) {
          item.command = {
            command: 'editor.action.triggerSuggest',
            title: 'Trigger Suggest',
          }
        }

        return item
      })
  }
}
