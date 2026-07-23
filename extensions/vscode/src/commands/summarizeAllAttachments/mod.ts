import * as vscode from 'vscode'
import * as path from 'node:path'
import SectionDocument from '#shared/models/Markdown/SectionDocument/mod.ts'
import { SUPPORTED_EXTENSIONS } from '../summarizeAttachment/mod.ts'

/**
 * Summarize ALL attachments by calling `attachment.summarize` for each one.
 */
export default async function summarizeAllAttachments(): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showWarningMessage('No active editor')
    return
  }

  if (!editor.document.fileName.endsWith('.md')) {
    vscode.window.showWarningMessage('This command only works on Markdown files')
    return
  }

  const text = editor.document.getText()
  const doc = SectionDocument.fromMarkdown(text)
  const attachments = doc.attachments

  const supported = attachments.filter((a) => {
    const ext = path.extname(a.file).toLowerCase()
    return SUPPORTED_EXTENSIONS.has(ext)
  })

  if (supported.length === 0) {
    vscode.window.showWarningMessage('No summarizable attachments found')
    return
  }

  let succeeded = 0
  const failed: string[] = []

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Summarizing all attachments',
      cancellable: true,
    },
    async (progress, token) => {
      for (let i = 0; i < supported.length; i++) {
        if (token.isCancellationRequested) break

        const filename = supported[i].file
        progress.report({
          message: `(${i + 1}/${supported.length}) ${filename}`,
          increment: (1 / supported.length) * 100,
        })

        try {
          await vscode.commands.executeCommand('attachment.summarize', filename)
          succeeded++
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failed.push(`${filename} (${message})`)
        }
      }
    },
  )

  if (failed.length === 0) {
    vscode.window.showInformationMessage(`Summarized all ${succeeded} attachment${succeeded === 1 ? '' : 's'}`)
  } else {
    vscode.window.showWarningMessage(
      `Summarized ${succeeded}/${supported.length}. Failed: ${failed.join(', ')}`,
    )
  }
}
