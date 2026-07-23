import * as vscode from 'vscode'
import { fetchNow } from '#shared/nbfs/mod.ts'

class NotebookTimeStatusBar {
  private statusBarItem: vscode.StatusBarItem
  private updateInterval: ReturnType<typeof setInterval> | undefined

  constructor(context: vscode.ExtensionContext) {
    // Create status bar item on the left side, high priority (shows first)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1000,
    )

    this.statusBarItem.text = '$(clock) --:--'
    this.updateStatusBar()
    this.statusBarItem.show()

    context.subscriptions.push(this.statusBarItem)

    // Update every minute
    this.updateInterval = setInterval(() => {
      this.updateStatusBar()
    }, 60_000)

    context.subscriptions.push({
      dispose: () => {
        if (this.updateInterval) clearInterval(this.updateInterval)
      },
    })
  }

  private async updateStatusBar() {
    try {
      const now = await fetchNow()
      const time = now.plainDateTime.time
      const date = now.plainDateTime.plainDate.ymd

      this.statusBarItem.text = `$(clock) ${time}`
      this.statusBarItem.tooltip = `Notebook Time: ${date} ${time}`
    } catch (error) {
      this.statusBarItem.text = '$(clock) --:--'
      this.statusBarItem.tooltip = 'Notebook time unavailable'
    }
  }

  dispose() {
    if (this.updateInterval) clearInterval(this.updateInterval)
    this.statusBarItem.dispose()
  }
}

let _statusBar: NotebookTimeStatusBar | undefined

export function activate(context: vscode.ExtensionContext) {
  try {
    _statusBar = new NotebookTimeStatusBar(context)
  } catch (error) {
    console.error('Failed to activate notebook time status bar:', error)
  }
}

export function deactivate() {
  _statusBar?.dispose()
}
