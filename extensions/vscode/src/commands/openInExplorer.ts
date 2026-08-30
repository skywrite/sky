import * as path from 'node:path'
import * as vscode from 'vscode'
import { DIR_BASE, PORT_SERVER } from '#config'

/**
 * Cmd+T, or the file tree's context menu: the file, opened in the web
 * explorer — the service's reading view, where a file's page is its
 * notebook-relative path under /explorer. The context menu passes the file
 * it was opened on; Cmd+T passes nothing, so the file is the editor's. An
 * open file is saved first, since the explorer renders what is on disk.
 */
export default async function openInExplorer(uri?: vscode.Uri): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri
  if (!target) return

  const url = explorerUrl(target.fsPath)
  if (!url) {
    vscode.window.showWarningMessage(`${path.basename(target.fsPath)} is outside the notebook — no explorer page.`)
    return
  }

  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === target.toString())
  if (open?.isDirty) await open.save()
  await vscode.env.openExternal(url)
}

/**
 * The explorer page for a file: `http://localhost:<port>/explorer/<path>`,
 * the path relative to the notebook root, one segment per directory.
 * Undefined for anything outside the notebook — no page exists for it.
 */
export function explorerUrl(
  filePath: string,
  notebookDir: string = DIR_BASE,
  port: number = PORT_SERVER,
): vscode.Uri | undefined {
  const relative = path.relative(path.resolve(notebookDir), path.resolve(filePath))
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined
  }
  return vscode.Uri.from({
    scheme: 'http',
    authority: `localhost:${port}`,
    path: `/explorer/${relative.split(path.sep).join('/')}`,
  })
}
