/**
 * DocumentLinkProvider for the `attachments:` field key in YAML frontmatter.
 *
 * Makes the `attachments` key Cmd+Clickable to open the day's attachment
 * folder in the OS file manager (Finder on macOS, Explorer on Windows).
 *
 * Uses a command URI so clicking opens the folder externally via
 * `vscode.env.openExternal()` rather than trying to open it in the editor.
 */

import * as path from 'node:path'
import * as vscode from 'vscode'
import { DIR_ATTACHMENTS } from '#config'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'

/** Regex to match the YAML frontmatter block */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/

/** Command ID registered in extension.ts to open a folder in the OS file manager */
export const COMMAND_OPEN_FOLDER = 'notebook.openFolderExternal'

export default class AttachmentsFieldDocumentLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.DocumentLink[] {
    // Only work for files in the time/ directory
    if (!document.fileName.includes('/time/')) return []

    const text = document.getText()
    const fmMatch = text.match(FRONTMATTER_RE)
    if (!fmMatch) return []

    const fmText = text.slice(0, fmMatch.index! + fmMatch[0].length)

    // Parse date from file path
    let date
    try {
      date = parseDateFromDayPath(document.uri.fsPath)
    } catch {
      return []
    }

    // Find the `attachments:` key line in frontmatter
    const lines = fmText.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(attachments)\s*:/)
      if (!match) continue

      const key = match[1]
      const range = new vscode.Range(i, 0, i, key.length)

      const folderPath = path.join(DIR_ATTACHMENTS, dayAttachmentsDir(date))
      const commandArgs = encodeURIComponent(JSON.stringify([folderPath]))
      const commandUri = vscode.Uri.parse(`command:${COMMAND_OPEN_FOLDER}?${commandArgs}`)

      const link = new vscode.DocumentLink(range, commandUri)
      link.tooltip = `Open in Finder: ${folderPath}`
      return [link]
    }

    return []
  }
}
