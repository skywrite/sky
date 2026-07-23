import * as vscode from 'vscode'

/**
 * Replace the entire document content with new content.
 */
export async function setDocumentContent(editor: vscode.TextEditor, content: string) {
  const doc = editor.document
  const fullRange = new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length)
  await editor.edit((editBuilder) => editBuilder.replace(fullRange, content))
}

/**
 * Find the list title (## heading) that contains the given line.
 * Scans upward from the line to find the nearest level 2 heading.
 */
export function findListTitle(document: vscode.TextDocument, line: number): string | null {
  for (let i = line; i >= 0; i--) {
    const lineText = document.lineAt(i).text
    if (lineText.startsWith('## ')) {
      return lineText.substring(3).trim()
    }
  }
  return null
}
