import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { DIR_ATTACHMENTS } from '#config'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'
import { isCursorInYamlFrontmatter } from '../util.ts'
import isCursorInRelevantYamlKey from '../util/isCursorInRelevantYamlKey.ts'
import { filterByPrefix } from './utils/matching.ts'
import { createReplacementRange } from './utils/ranges.ts'

export default class AttachmentsCompletionItemProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ) {
    // Only trigger in YAML frontmatter
    const inFrontMatter = isCursorInYamlFrontmatter(document, position)
    if (!inFrontMatter) return

    // Only trigger when in the attachments field
    const inAttachmentsField = isCursorInRelevantYamlKey(document, position, ['attachments'])
    if (!inAttachmentsField) return

    // Only work for files in the time/ directory
    if (!document.fileName.includes('/time/')) return

    // Parse the date from the file path
    let date
    try {
      date = parseDateFromDayPath(document.fileName)
    } catch (error) {
      // If we can't parse the date, silently fail
      return
    }

    // Construct the attachments directory path
    const attachmentsDir = path.join(DIR_ATTACHMENTS, dayAttachmentsDir(date))

    // Extract search term after "file:"
    // Handle: "file: ", "file: filename", "file: "filename", etc.
    const line = document.lineAt(position).text
    const linePrefix = line.substring(0, position.character)
    const fileMatch = linePrefix.match(/file:\s*"?([^"]*)?$/)
    const searchTerm = fileMatch ? fileMatch[1] || '' : ''

    // Read files from the attachments directory
    let files
    try {
      const dirEntries = await fs.readdir(attachmentsDir, { withFileTypes: true })
      // Only include files, not directories
      files = dirEntries.filter((entry) => entry.isFile()).map((entry) => entry.name)
    } catch (error) {
      // Directory doesn't exist or can't be read - return empty completions
      return
    }

    // Filter files by search term
    const matchingFiles = filterByPrefix(files, searchTerm)

    // Create completion items for each file
    return matchingFiles.map((filename) => {
      const item = new vscode.CompletionItem(filename, vscode.CompletionItemKind.File)
      item.insertText = filename
      item.range = createReplacementRange(position, searchTerm.length)
      item.detail = `Attachment from ${date.toString()}`
      return item
    })
  }
}
