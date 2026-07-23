import * as vscode from 'vscode'
import Day from '#shared/models/Day/mod.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'
import { setDocumentContent } from './util.ts'
import type { SmartTodoClipboard } from './dayMarkdownTodoHandler.ts'

/**
 * Clipboard format for smart copy/paste of reminders with reference links.
 */
export interface SmartReminderClipboard {
  type: 'notebook-reminder'
  text: string
  links: Record<string, { label: string; href: string; title?: string }>
}

type SmartClipboard = SmartReminderClipboard | SmartTodoClipboard

/**
 * Handles adding reminders to the day file.
 * Reminders are lightweight items that don't need tracking -
 * they're dismissed (deleted) throughout the day via CMD+SHIFT+D.
 */
class ReminderController {
  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand('reminder.add', async () => {
        await this.addReminder()
      }),
    )
    context.subscriptions.push(
      vscode.commands.registerCommand('reminder.dismiss', async (line?: number) => {
        await this.dismissReminder(line)
      }),
    )
    context.subscriptions.push(
      vscode.commands.registerCommand('reminder.smartPaste', async () => {
        await this.smartPaste()
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
   * Dismiss (delete) a reminder from the Reminders section.
   * Copies the reminder with any reference links to clipboard (smart copy),
   * then removes the reminder. Removes the section if it becomes empty.
   */
  public async dismissReminder(line?: number) {
    const editor = vscode.window.activeTextEditor
    if (!editor || !this.isValidMarkdownFile(editor.document)) return
    if (!editor.document.fileName.endsWith('day.md')) return

    const lineNumber = (line !== undefined) ? line : editor.selection.active.line
    const document = editor.document
    const lineText = document.lineAt(lineNumber).text

    const parsed = this.parseListItem(lineText)
    if (!parsed) return

    const taskContent = parsed.content

    try {
      let day = this.parseDay(document)
      if (!day) return

      const remindersList = day.lists.find((l) => l.title === 'Reminders')
      if (!remindersList) return

      const itemIndex = remindersList.items.findIndex((item) => item === taskContent)
      if (itemIndex === -1) return

      // Extract the item and its links before removing
      const removeResult = remindersList.remove(itemIndex)
      const extractedLinks = removeResult.links

      // Build smart clipboard payload
      const clipboardPayload: SmartReminderClipboard = {
        type: 'notebook-reminder',
        text: taskContent,
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

      day = day.removeItem('Reminders', itemIndex)

      // Remove Reminders section if empty
      const updatedRemindersList = day.lists.find((l) => l.title === 'Reminders')
      if (updatedRemindersList && updatedRemindersList.size === 0) {
        const remindersIndex = day.lists.findIndex((l) => l.title === 'Reminders')
        if (remindersIndex !== -1) {
          day = day.removeList(remindersIndex)
        }
      }

      await setDocumentContent(editor, day!.toMarkdown())
    } catch (error) {
      console.error('Failed to dismiss reminder:', error)
      vscode.window.showErrorMessage(`Failed to dismiss reminder: ${error}`)
    }
  }

  /**
   * Show input box and add reminder to the Reminders section.
   * Creates the section if it doesn't exist.
   */
  public async addReminder() {
    const editor = vscode.window.activeTextEditor
    if (!editor || !this.isValidMarkdownFile(editor.document)) return
    if (!editor.document.fileName.endsWith('day.md')) return

    const reminder = await vscode.window.showInputBox({
      prompt: 'Enter reminder',
      placeHolder: 'e.g., Take vitamins, Create most important task',
    })

    if (!reminder || reminder.trim() === '') return

    try {
      const document = editor.document
      let day = this.parseDay(document)
      if (!day) return

      day = day.addReminderItem(reminder.trim())

      await setDocumentContent(editor, day!.toMarkdown())
    } catch (error) {
      console.error('Failed to add reminder:', error)
      vscode.window.showErrorMessage(`Failed to add reminder: ${error}`)
    }
  }

  /**
   * Smart paste: if clipboard contains a smart reminder/backlog format and we're in a day file,
   * paste the item with its reference links into the appropriate section.
   * Creates the section if it doesn't exist.
   * Otherwise, fall back to standard paste.
   */
  public async smartPaste() {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction')
      return
    }

    // Only handle smart paste for day markdown files
    if (!this.isValidMarkdownFile(editor.document) || !editor.document.fileName.endsWith('day.md')) {
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction')
      return
    }

    const clipboardText = await vscode.env.clipboard.readText()

    // Try to parse as smart clipboard format (reminder or todo)
    let payload: SmartClipboard | null = null
    try {
      const parsed = JSON.parse(clipboardText)
      if (parsed && typeof parsed.text === 'string') {
        if (parsed.type === 'notebook-reminder' || parsed.type === 'notebook-todo') {
          payload = parsed as SmartClipboard
        }
      }
    } catch {
      // Not JSON, fall back to standard paste
    }

    // If not a smart format, do standard paste
    if (!payload) {
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction')
      return
    }

    // Smart paste the item with links
    try {
      let day = this.parseDay(editor.document)
      if (!day) {
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction')
        return
      }

      // Convert links from clipboard format to Map<string, Link>
      const linksMap = new Map<string, Link>()
      if (payload.links) {
        Object.entries(payload.links).forEach(([label, link]) => {
          linksMap.set(label, {
            label: link.label,
            href: link.href,
            ...(link.title ? { title: link.title } : {}),
          })
        })
      }

      if (payload.type === 'notebook-reminder') {
        // Add to Reminders section (creates it if needed)
        day = day.addReminderItem(payload.text, { links: linksMap })
      } else {
        // Add to Todos section (creates it if needed)
        day = day.addTodoItem(payload.text, { category: payload.category, links: linksMap })
      }

      await setDocumentContent(editor, day!.toMarkdown())
    } catch (error) {
      console.error('Failed to smart paste:', error)
      // Fall back to standard paste on error
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction')
    }
  }
}

let _controller: ReminderController | undefined

export function activate(context: vscode.ExtensionContext) {
  try {
    console.log('Activating ReminderController...')
    _controller = new ReminderController(context)
    console.log('ReminderController activated successfully')
  } catch (error) {
    console.error('Failed to activate ReminderController:', error)
    vscode.window.showErrorMessage(`Failed to activate reminder handler: ${error}`)
  }
}

export function deactivate() {
  console.log('Deactivating ReminderController...')
  _controller = undefined
}
