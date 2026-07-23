import * as vscode from 'vscode'
import Day from '#shared/models/Day/mod.ts'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import { findListTitle, setDocumentContent } from './util.ts'

/**
 * Handles moving tasks to/from "Dropped" sections.
 * Dropped sections capture tasks that were intentionally not done.
 */
class DroppedController {
  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand('checkbox.dropTask', async (line?: number) => {
        await this.dropTask(line)
      }),
    )
  }

  /**
   * Parse a list item and return its prefix and content
   * Supports both bullet (- ) and numbered (1. ) list items
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
   * Drop a task - move it to the "Dropped" section for the current category.
   * If already in "Dropped", move it back to "Todos".
   * Creates "Dropped" section if it doesn't exist.
   * Removes "Dropped" section if it becomes empty.
   */
  public async dropTask(line?: number) {
    const editor = vscode.window.activeTextEditor
    if (!editor || !this.isValidMarkdownFile(editor.document)) return
    if (!editor.document.fileName.endsWith('day.md')) return

    const lineNumber = (line !== undefined) ? line : editor.selection.active.line
    await this.moveTaskToDropped(editor, lineNumber)
  }

  private async moveTaskToDropped(editor: vscode.TextEditor, lineNumber: number) {
    try {
      const document = editor.document
      const lineText = document.lineAt(lineNumber).text

      const parsed = this.parseListItem(lineText)
      if (!parsed) return

      const taskContent = parsed.content

      // Find the current list title
      const currentSectionTitle = findListTitle(document, lineNumber)
      if (!currentSectionTitle) return

      // Delegate Reminders section to ReminderController
      if (currentSectionTitle === 'Reminders') {
        await vscode.commands.executeCommand('reminder.dismiss', lineNumber)
        return
      }

      // Determine category (Personal or Professional) from section title
      let category: 'Personal' | 'Professional' | null = null
      if (currentSectionTitle.startsWith('Personal')) {
        category = 'Personal'
      } else if (currentSectionTitle.startsWith('Professional')) {
        category = 'Professional'
      }

      if (!category) return

      const isInDropped = currentSectionTitle.endsWith('Dropped')
      const droppedSectionTitle = `${category} Dropped`
      const todosSectionTitle = `${category} Todos`

      let day = this.parseDay(document)
      if (!day) return

      const sourceList = day.lists.find((l) => l.title === currentSectionTitle)
      if (!sourceList) return

      const itemIndex = sourceList.items.findIndex((item) => item === taskContent)
      if (itemIndex === -1) return

      // Extract reference links for this item from the document before removing it
      const itemLinks = day.referenceLinks(taskContent)

      // Remove strikethrough if present
      let cleanTaskContent = taskContent
      if (taskContent.match(/^~~.*~~$/)) {
        cleanTaskContent = taskContent.replace(/^~~(.*)~~$/, '$1')
      }

      if (isInDropped) {
        // Moving FROM Dropped back to Todos
        const targetList = day.lists.find((l) => l.title === todosSectionTitle)
        if (!targetList) {
          vscode.window.showWarningMessage(`Cannot find "${todosSectionTitle}" section`)
          return
        }

        day = day.removeItem(currentSectionTitle, itemIndex)
        day = day.addItem(todosSectionTitle, cleanTaskContent, { links: itemLinks })

        // Remove Dropped section if empty
        const updatedDroppedList = day.lists.find((l) => l.title === droppedSectionTitle)
        if (updatedDroppedList && updatedDroppedList.size === 0) {
          const droppedIndex = day.lists.findIndex((l) => l.title === droppedSectionTitle)
          if (droppedIndex !== -1) {
            day = day.removeList(droppedIndex)
          }
        }
      } else {
        // Moving TO Dropped
        const targetList = day.lists.find((l) => l.title === droppedSectionTitle)

        day = day.removeItem(currentSectionTitle, itemIndex)

        if (targetList) {
          day = day.addItem(droppedSectionTitle, cleanTaskContent, { links: itemLinks })
        } else {
          // Creating new Dropped section
          // Ensure "Professional Dropped" always appears before "Personal Dropped"
          const newDroppedList = ItemList.fromArray({ title: droppedSectionTitle }, [])

          if (category === 'Professional') {
            // Insert before Personal Dropped if it exists, otherwise append
            const personalDroppedIndex = day.lists.findIndex((l) => l.title === 'Personal Dropped')
            if (personalDroppedIndex !== -1) {
              day = day.insertList(personalDroppedIndex, newDroppedList)
            } else {
              day = day.addList(newDroppedList)
            }
          } else {
            // Personal Dropped - just append, it'll be after Professional Dropped if that exists
            day = day.addList(newDroppedList)
          }

          day = day.addItem(droppedSectionTitle, cleanTaskContent, { links: itemLinks })
        }
      }

      await setDocumentContent(editor, day!.toMarkdown())
    } catch (error) {
      console.error('Failed to drop task:', error)
      vscode.window.showErrorMessage(`Failed to drop task: ${error}`)
    }
  }
}

let _controller: DroppedController | undefined

export function activate(context: vscode.ExtensionContext) {
  try {
    console.log('Activating DroppedController...')
    _controller = new DroppedController(context)
    console.log('DroppedController activated successfully')
  } catch (error) {
    console.error('Failed to activate DroppedController:', error)
    vscode.window.showErrorMessage(`Failed to activate dropped handler: ${error}`)
  }
}

export function deactivate() {
  console.log('Deactivating DroppedController...')
  _controller = undefined
}
