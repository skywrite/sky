import * as vscode from 'vscode'
import { isValidPattern } from '#universal/dates/recurring/patterns.ts'

class RecurringPatternHighlighter {
  private patternDecoration: vscode.TextEditorDecorationType

  constructor(context: vscode.ExtensionContext) {
    // Yellow text decoration for valid patterns
    this.patternDecoration = vscode.window.createTextEditorDecorationType({
      color: '#E5C07B', // Soft yellow that works in both light and dark themes
      fontWeight: 'bold',
    })

    // Register disposables
    context.subscriptions.push(
      this.patternDecoration,
      // Update decorations when document changes
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor
        if (editor && event.document === editor.document && this.isPatternFile(event.document)) {
          this.updateDecorations(editor)
        }
      }),
      // Update decorations when editor changes
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && this.isPatternFile(editor.document)) {
          this.updateDecorations(editor)
        }
      }),
    )

    // Initial update for active editor
    if (vscode.window.activeTextEditor && this.isPatternFile(vscode.window.activeTextEditor.document)) {
      this.updateDecorations(vscode.window.activeTextEditor)
    }
  }

  private isPatternFile(document: vscode.TextDocument): boolean {
    const fileName = document.fileName.toLowerCase()
    return document.languageId === 'markdown' && (fileName.includes('recurring') || fileName.includes('reminders'))
  }

  private updateDecorations(editor: vscode.TextEditor) {
    if (!this.isPatternFile(editor.document)) return

    const decorations: vscode.DecorationOptions[] = []

    for (let i = 0; i < editor.document.lineCount; i++) {
      const line = editor.document.lineAt(i)
      const text = line.text

      // Match level 2 heading: ## PATTERN
      const match = text.match(/^##\s+(.+)$/)
      if (match) {
        const pattern = match[1].trim().toUpperCase()
        if (isValidPattern(pattern)) {
          // Highlight only the pattern part (after "## ")
          const patternStart = text.indexOf(match[1])
          const patternEnd = patternStart + match[1].length
          const range = new vscode.Range(i, patternStart, i, patternEnd)
          decorations.push({ range })
        }
      }
    }

    editor.setDecorations(this.patternDecoration, decorations)
  }

  dispose() {
    this.patternDecoration.dispose()
  }
}

let _highlighter: RecurringPatternHighlighter | undefined

export function activate(context: vscode.ExtensionContext) {
  _highlighter = new RecurringPatternHighlighter(context)
}

export function deactivate() {
  _highlighter?.dispose()
}
