import * as vscode from 'vscode'
import Day from '#shared/models/Day/mod.ts'
import { findListTitle, setDocumentContent } from './util.ts'

// TODO: currently hiding checkboxes on incomplete
// I don't like the placement of them in the gutter
// experimenting with showing them on complete
// the incmplete checkboxes also show up in the "complete" sections
//    so I'll have to add some logic there

class CheckboxController {
  private uncheckedDecoration: vscode.TextEditorDecorationType
  private checkedDecoration: vscode.TextEditorDecorationType

  constructor(context: vscode.ExtensionContext) {
    // Resources ship alongside the source (no bundle dir anymore).
    this.uncheckedDecoration = vscode.window.createTextEditorDecorationType({
      // gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'resources', 'checkbox-unchecked.svg'),
      gutterIconSize: '16px',
    })

    this.checkedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'resources', 'checkbox-checked.svg'),
      gutterIconSize: '16px',
    })

    // Test command for line number clicks
    // TODO: not being used for anything, consider using it to toggle the Gutter checkbox
    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!this.isValidMarkdownFile(event.textEditor.document)) return

        if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
          const editor = event.textEditor
          const line = event.selections[0].active.line
          const character = event.selections[0].active.character
          // console.log('Line number Click detected:', { line, character })
          // TODO: does not work well
          // this.toggleCheckbox(line)
        }
      }),
    )

    // Register the disposables
    context.subscriptions.push(
      this.uncheckedDecoration,
      this.checkedDecoration,
      // Update decorations when document changes
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor
        if (editor && event.document === editor.document && this.isValidMarkdownFile(event.document)) {
          this.updateDecorations(editor)
        }
      }),
      // Update decorations when editor changes
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && this.isValidMarkdownFile(editor.document)) {
          this.updateDecorations(editor)
        }
      }),
    )

    // Initial update for active editor
    if (vscode.window.activeTextEditor) {
      this.updateDecorations(vscode.window.activeTextEditor)
    }

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('checkbox.toggleGutter', async (line?: number) => {
        await this.toggleCheckbox(line)
      }),
      this.uncheckedDecoration,
      this.checkedDecoration,
      // Update decorations when document changes
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor
        if (editor && event.document === editor.document && this.isValidMarkdownFile(event.document)) {
          this.updateDecorations(editor)
        }
      }),
      // Update decorations when editor changes
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && this.isValidMarkdownFile(editor.document)) {
          this.updateDecorations(editor)
        }
      }),
    )

    // Initial update for active editor
    if (vscode.window.activeTextEditor) {
      this.updateDecorations(vscode.window.activeTextEditor)
    }
  }

  /**
   * Parse a list item and return its prefix and content
   * Supports both bullet (- ) and numbered (1. ) list items
   */
  private parseListItem(text: string): { prefix: string; content: string } | null {
    // Match bullet list: - item
    const bulletMatch = text.match(/^(\s*-\s+)(.*)$/)
    if (bulletMatch) {
      return { prefix: bulletMatch[1], content: bulletMatch[2] }
    }

    // Match numbered list: 1. item, 2. item, etc.
    const numberedMatch = text.match(/^(\s*\d+\.\s+)(.*)$/)
    if (numberedMatch) {
      return { prefix: numberedMatch[1], content: numberedMatch[2] }
    }

    return null
  }

  private isChecked(text: string): boolean {
    const parsed = this.parseListItem(text)
    if (!parsed) return false

    const content = parsed.content

    // Check if the content starts with a time in 24-hour format
    const timeMatch = content.match(/^(\d{2}:\d{2}\s*>?\s*)(.*)$/)

    if (timeMatch) {
      // For time-prefixed content, only check the task part
      const [_, timePart, taskPart] = timeMatch
      return taskPart.match(/^~~.*~~$/) !== null
    } else {
      // For regular content, check if it's wrapped in strikethrough
      return content.match(/^~~.*~~$/) !== null
    }
  }

  private isValidMarkdownFile(document: vscode.TextDocument): boolean {
    return document.languageId === 'markdown'
  }

  public async toggleCheckbox(line?: number) {
    const editor = vscode.window.activeTextEditor
    if (!editor || !this.isValidMarkdownFile(editor.document)) return

    // If line is provided, use it. Otherwise use current cursor position
    const lineNumber = (line !== undefined) ? line : editor.selection.active.line
    await this.toggleCheckboxAndStrikethrough(editor, lineNumber)
  }

  private async toggleCheckboxAndStrikethrough(editor: vscode.TextEditor, line: number) {
    const document = editor.document
    const lineText = document.lineAt(line)
    const text = lineText.text

    // Parse the list item (supports both bullet and numbered lists)
    const parsed = this.parseListItem(text)
    if (!parsed) return

    const { prefix, content } = parsed

    // Check if we're in the Reminders section and show a warning
    const listTitle = findListTitle(document, line)
    if (listTitle === 'Reminders') {
      vscode.window.showInformationMessage('Reminders are for acknowledgment, not tracking. Use Todos for tasks you want to complete.')
    }

    // Check if the content starts with a time in 24-hour format
    const timeMatch = content.match(/^(\d{2}:\d{2}\s*>?\s*)(.*)$/)

    if (timeMatch) {
      // Handle time-prefixed content
      const [_, timePart, taskPart] = timeMatch
      const isCurrentlyChecked = this.isChecked(text)

      let newText: string
      if (isCurrentlyChecked) {
        // Remove strikethrough if it exists
        newText = `${prefix}${timePart}${taskPart.replace(/^~~(.*)~~$/, '$1')}`
      } else {
        // Add strikethrough if it doesn't exist
        if (!taskPart.startsWith('~~')) {
          newText = `${prefix}${timePart}~~${taskPart}~~`
        } else {
          return // Already has strikethrough
        }
      }

      // Update the text content
      await editor.edit((editBuilder) => {
        const range = new vscode.Range(line, 0, line, lineText.text.length)
        editBuilder.replace(range, newText)
      })
    } else {
      // Handle regular content without time prefix
      const isCurrentlyChecked = this.isChecked(text)

      let newText: string
      if (isCurrentlyChecked) {
        // Remove strikethrough if it exists
        newText = `${prefix}${content.replace(/^~~(.*)~~$/, '$1')}`
      } else {
        // Add strikethrough if it doesn't exist
        if (!content.startsWith('~~')) {
          newText = `${prefix}~~${content}~~`
        } else {
          return // Already has strikethrough
        }
      }

      // Update the text content
      await editor.edit((editBuilder) => {
        const range = new vscode.Range(line, 0, line, lineText.text.length)
        editBuilder.replace(range, newText)
      })

      // Sort if toggling an item without a time AND we're in a day.md file
      if (!timeMatch && document.fileName.endsWith('day.md')) {
        await this.sortListAfterCheck(editor, line)
      }
    }

    // Update decorations after the edit
    this.updateDecorations(editor)
  }

  private async sortListAfterCheck(editor: vscode.TextEditor, checkedLine: number) {
    try {
      const day = this.parseDay(editor.document)
      if (!day) return

      // Find which list contains the checked item
      let listTitle: string | null = null
      let listStartLine = -1
      let inList = false

      for (let i = checkedLine; i >= 0; i--) {
        const line = editor.document.lineAt(i).text
        if (line.startsWith('## ')) {
          listTitle = line.substring(3).trim()
          listStartLine = i
          break
        }
      }

      if (!listTitle || listStartLine === -1) return

      // Get the list from the Day model
      const list = day.lists.find((l) => l.title === listTitle)
      if (!list) return

      // Create a sorting predicate that moves checked items without time to the top
      const sortingPredicate = (a: string, b: string) => {
        const aDone = Day.isItemDone(a) && Day.itemDoesNotStartWithTime(a)
        const bDone = Day.isItemDone(b) && Day.itemDoesNotStartWithTime(b)

        if (aDone && bDone) return 0
        if (aDone && !bDone) return -1
        if (!aDone && bDone) return 1

        return 0
      }

      // Sort the list
      const sortedList = list.toSorted(sortingPredicate)

      // Replace the list in the document
      const newDay = day.replaceList(listTitle, sortedList)

      // Update the entire document
      await setDocumentContent(editor, newDay.toMarkdown())
    } catch (error) {
      console.error('Failed to sort list after check:', error)
    }
  }

  private updateDecorations(editor: vscode.TextEditor) {
    if (!this.isValidMarkdownFile(editor.document)) {
      console.log('Not a valid markdown file:', editor.document.fileName)
      return
    }

    const uncheckedDecorations: vscode.DecorationOptions[] = []
    const checkedDecorations: vscode.DecorationOptions[] = []

    for (let i = 0; i < editor.document.lineCount; i++) {
      const line = editor.document.lineAt(i)
      // Check if this is a list item (bullet or numbered)
      if (this.parseListItem(line.text)) {
        const isChecked = this.isChecked(line.text)
        const range = new vscode.Range(i, 0, i, 0)

        if (isChecked) {
          checkedDecorations.push({ range })
        } else {
          uncheckedDecorations.push({ range })
        }
      }
    }

    /*
    console.log('Setting decorations:', {
      fileName: editor.document.fileName,
      uncheckedCount: uncheckedDecorations.length,
      checkedCount: checkedDecorations.length,
    })
    */

    editor.setDecorations(this.uncheckedDecoration, uncheckedDecorations)
    editor.setDecorations(this.checkedDecoration, checkedDecorations)
  }

  dispose() {
    this.uncheckedDecoration.dispose()
    this.checkedDecoration.dispose()
  }

  /**
   * Parse the document using the Day model to get structured data
   * This can be used for more advanced features in the future
   */
  private parseDay(document: vscode.TextDocument): Day | null {
    try {
      const content = document.getText()
      const day = Day.fromMarkdown(content)
      return day
    } catch (error) {
      console.error('Failed to parse day document:', error)
      return null
    }
  }
}

let _controller: CheckboxController | undefined
export function activate(context: vscode.ExtensionContext) {
  try {
    console.log('Activating CheckboxController...')
    _controller = new CheckboxController(context)
    console.log('CheckboxController activated successfully')
  } catch (error) {
    console.error('Failed to activate CheckboxController:', error)
    vscode.window.showErrorMessage(`Failed to activate checkbox handler: ${error}`)
  }
}

export function deactivate() {
  console.log('Deactivating CheckboxController...')
  _controller?.dispose()
}
