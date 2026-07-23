import * as vscode from 'vscode'

export default function isCursorInRelevantYamlKey(
  document: vscode.TextDocument,
  position: vscode.Position,
  relevantKeys: string[],
): boolean {
  // const relevantKeys = ['who', 'to', 'from', 'cc', 'bcc', 'rel']

  // Get the text before the cursor position
  const line = document.lineAt(position).text
  const linePrefix = line.substr(0, position.character).trim()

  // Check if the current line starts with any of the relevant keys
  if (relevantKeys.some((key) => linePrefix.startsWith(`${key}:`))) {
    return true
  }

  // Now scan upwards to check if we're still within the relevant section
  const currentLineNumber = position.line
  for (let i = currentLineNumber; i >= 0; i--) {
    const currentLineText = document.lineAt(i).text.trim()

    // If we find any of the relevant keys, we're in the relevant section
    if (relevantKeys.some((key) => currentLineText.startsWith(`${key}:`))) {
      return true
    }

    // If we find another key in the YAML, we're not in the relevant section anymore
    if (currentLineText.match(/^[^:\s]+:/)) {
      return false
    }
  }

  return false
}
