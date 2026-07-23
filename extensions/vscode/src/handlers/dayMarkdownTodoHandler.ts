import * as vscode from 'vscode'
import Day from '#shared/models/Day/mod.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'
import { findListTitle, setDocumentContent } from './util.ts'

/**
 * Clipboard format for smart copy/paste of todo items with reference links.
 */
export interface SmartTodoClipboard {
  type: 'notebook-todo'
  text: string
  category: 'Professional' | 'Personal'
  links: Record<string, { label: string; href: string; title?: string }>
}

/**
 * Handles cutting and pasting todo items with their reference links.
 * CMD+X cuts a todo item (smart copy + remove).
 * CMD+V pastes it back (handled by reminder handler's smartPaste).
 */
class TodoController {
  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand('todo.cut', async (line?: number) => {
        await this.cutItem(line)
      }),
    )
  }

  private isValidMarkdownFile(document: vscode.TextDocument): boolean {
    return document.languageId === 'markdown'
  }

  private parseDay(document: vscode.TextDocument): Day | null {
    try {
      const content = document.getText()
      return Day.fromMarkdown(content)
    } catch (error) {
      console.error('Failed to parse day document:', error)
      return null
    }
  }

  /**
   * Parse a list item and return its content
   */
  private parseListItem(text: string): { prefix: string; content: string } | null {
    const bulletMatch = text.match(/^(\s*-\s+)(.*)$/)
    if (bulletMatch) {
      return { prefix: bulletMatch[1], content: bulletMatch[2] }
    }

    const numberedMatch = text.match(/^(\s*\d+\.\s+)(.*)$/)
    if (numberedMatch) {
      return { prefix: numberedMatch[1], content: numberedMatch[2] }
    }

    return null
  }

  /**
   * Cut a todo item - copy to clipboard with links, then remove.
   * Only works on items in Todos sections.
   */
  public async cutItem(line?: number) {
    const editor = vscode.window.activeTextEditor
    if (!editor || !this.isValidMarkdownFile(editor.document)) {
      // Fall back to standard cut
      await vscode.commands.executeCommand('editor.action.clipboardCutAction')
      return
    }
    if (!editor.document.fileName.endsWith('day.md')) {
      await vscode.commands.executeCommand('editor.action.clipboardCutAction')
      return
    }

    const lineNumber = (line !== undefined) ? line : editor.selection.active.line
    const document = editor.document
    const lineText = document.lineAt(lineNumber).text

    const parsed = this.parseListItem(lineText)
    if (!parsed) {
      await vscode.commands.executeCommand('editor.action.clipboardCutAction')
      return
    }

    const taskContent = parsed.content

    // Find the current list title
    const currentSectionTitle = findListTitle(document, lineNumber)
    if (!currentSectionTitle || !currentSectionTitle.endsWith('Todos')) {
      // Not in a Todos section, fall back to standard cut
      await vscode.commands.executeCommand('editor.action.clipboardCutAction')
      return
    }

    // Determine category from section title
    let category: 'Professional' | 'Personal'
    if (currentSectionTitle.startsWith('Personal')) {
      category = 'Personal'
    } else {
      category = 'Professional'
    }

    try {
      let day = this.parseDay(document)
      if (!day) {
        await vscode.commands.executeCommand('editor.action.clipboardCutAction')
        return
      }

      const todoList = day.lists.find((l) => l.title === currentSectionTitle)
      if (!todoList) {
        await vscode.commands.executeCommand('editor.action.clipboardCutAction')
        return
      }

      const itemIndex = todoList.items.findIndex((item) => item === taskContent)
      if (itemIndex === -1) {
        await vscode.commands.executeCommand('editor.action.clipboardCutAction')
        return
      }

      // Extract the item and its links before removing
      const removeResult = todoList.remove(itemIndex)
      const extractedLinks = removeResult.links

      // Build smart clipboard payload
      const clipboardPayload: SmartTodoClipboard = {
        type: 'notebook-todo',
        text: taskContent,
        category,
        links: {},
      }

      if (extractedLinks) {
        extractedLinks.forEach((link, label) => {
          clipboardPayload.links[label] = {
            label: link.label,
            href: link.href,
            ...(link.title ? { title: link.title } : {}),
          }
        })
      }

      // Copy to clipboard
      await vscode.env.clipboard.writeText(JSON.stringify(clipboardPayload))

      // Remove the item
      day = day.removeItem(currentSectionTitle, itemIndex)

      await setDocumentContent(editor, day!.toMarkdown())
    } catch (error) {
      console.error('Failed to cut todo item:', error)
      // Fall back to standard cut on error
      await vscode.commands.executeCommand('editor.action.clipboardCutAction')
    }
  }
}

let _controller: TodoController | undefined

export function activate(context: vscode.ExtensionContext) {
  try {
    console.log('Activating TodoController...')
    _controller = new TodoController(context)
    console.log('TodoController activated successfully')
  } catch (error) {
    console.error('Failed to activate TodoController:', error)
    vscode.window.showErrorMessage(`Failed to activate todo handler: ${error}`)
  }
}

export function deactivate() {
  console.log('Deactivating TodoController...')
  _controller = undefined
}
