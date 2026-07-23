import * as vscode from 'vscode'
import { fetchNow, parseDateFromDayPath } from '#shared/nbfs/mod.ts'
import { findListTitle } from '../handlers/util.ts'

/**
 * Auto-inserts time prefix when typing in a "Complete" section.
 *
 * Triggers:
 * - User types ' ' after '-' to make '- ' → becomes '- XX:YY > '
 * - User types '>' after '- ' → becomes '- XX:YY > '
 *
 * Time logic:
 * - If file's day == notebook time day → insert notebook time (can extend past 24:00)
 * - If file's day > notebook time day → insert wall clock / system time
 * - If file's day < notebook time day → don't insert anything
 */
class CompleteTimeInsertHandler {
  private isProcessing = false

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.handleDocumentChange(event)
      }),
    )
  }

  private async handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
    // Prevent re-entrant calls (our edits trigger this handler too)
    if (this.isProcessing) return

    // Only handle day files
    if (!event.document.fileName.endsWith('day.md')) return

    // Get the editor
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document !== event.document) return

    // Process each change
    for (const change of event.contentChanges) {
      await this.processChange(editor, change)
    }
  }

  private async processChange(
    editor: vscode.TextEditor,
    change: vscode.TextDocumentContentChangeEvent,
  ) {
    // Only interested in single character insertions
    if (change.text.length !== 1) return

    const lineNum = change.range.start.line
    const line = editor.document.lineAt(lineNum)
    const lineText = line.text

    // Pattern 1: Line is exactly '- ' (user just typed space after dash)
    // Pattern 2: Line is '- >' (user typed '>' after '- ')
    const isPattern1 = lineText === '- '
    const isPattern2 = lineText === '- >'

    if (!isPattern1 && !isPattern2) return

    // Check if we're in a Complete section
    const listTitle = findListTitle(editor.document, lineNum)
    if (!listTitle || !listTitle.endsWith('Complete')) return

    // Get the time to insert
    const time = await this.getTimeToInsert(editor.document.fileName)
    if (!time) return

    // Insert the time
    this.isProcessing = true
    try {
      await editor.edit((editBuilder) => {
        const replaceRange = new vscode.Range(lineNum, 0, lineNum, lineText.length)
        editBuilder.replace(replaceRange, `- ${time} > `)
      })
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Determines the time to insert based on file date vs notebook time.
   * @returns Time string in HH:MM format, or null if no time should be inserted
   */
  private async getTimeToInsert(filePath: string): Promise<string | null> {
    try {
      // Parse the file's date
      const fileDate = parseDateFromDayPath(filePath)
      const fileYMD = fileDate.ymd

      // Get notebook time
      const notebookNow = await fetchNow()
      const notebookYMD = notebookNow.plainDateTime.plainDate.ymd

      if (fileYMD === notebookYMD) {
        // Same day: use notebook time (can extend past 24:00)
        return notebookNow.plainDateTime.time
      } else if (fileYMD > notebookYMD) {
        // Future day: use wall clock / system time
        const now = new Date()
        const hours = now.getHours().toString().padStart(2, '0')
        const minutes = now.getMinutes().toString().padStart(2, '0')
        return `${hours}:${minutes}`
      } else {
        // Past day: don't insert anything
        return null
      }
    } catch (error) {
      console.error('Failed to determine time to insert:', error)
      return null
    }
  }
}

let _handler: CompleteTimeInsertHandler | undefined

export function activate(context: vscode.ExtensionContext) {
  try {
    _handler = new CompleteTimeInsertHandler(context)
  } catch (error) {
    console.error('Failed to activate complete time insert handler:', error)
  }
}

export function deactivate() {
  _handler = undefined
}
