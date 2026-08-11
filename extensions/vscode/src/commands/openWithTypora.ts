import * as cp from 'node:child_process'
import * as vscode from 'vscode'
import { uriToDocument } from '../util.ts'

const APP_PATH = '/Applications/Typora.app'
const BIN = 'open' // we use open to bring Typora to the topmost / foreground

export default async function openWithTypora(uri?: vscode.Uri): Promise<void> {
  let filePath: string | undefined
  if (uri) {
    filePath = uri.fsPath

    const doc = uriToDocument(uri)
    if (doc) await doc.save()
  } else {
    const activeEditor = vscode.window.activeTextEditor
    if (activeEditor) {
      filePath = activeEditor.document.uri.fsPath
      await activeEditor.document.save()
    }
  }

  if (filePath) await executeDetachedSystemCommand(BIN, ['-a', APP_PATH, filePath])
}

function executeDetachedSystemCommand(command: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = cp.spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    })

    process.on('error', (error) => {
      reject(error)
    })

    process.unref()
    resolve(`Detached process started: ${command} ${args.join(' ')}`)
  })
}
