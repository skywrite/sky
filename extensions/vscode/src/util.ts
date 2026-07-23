import * as vscode from 'vscode'

export function uriToDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  const editors = vscode.window.visibleTextEditors
  for (const editor of editors) {
    if (editor.document.uri.toString() === uri.toString()) return editor.document
  }
}

export function isCursorInYamlFrontmatter(document: vscode.TextDocument, position: vscode.Position): boolean {
  // vscode.window.setStatusBarMessage(`FUCK YOU: ${shit.shit()}`, 2000)

  const yamlPreambleRegExp = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
  const text = document.getText()
  const match = text.match(yamlPreambleRegExp)
  if (!match) {
    return false
  }

  const start = document.positionAt(match.index as number)
  const end = document.positionAt((match.index as number) + match[0].length)
  const range = new vscode.Range(start, end)

  return range.contains(position)
}
