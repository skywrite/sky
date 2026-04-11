/**
 * Open a file in the user's editor and wait for them to close it.
 */

import openEditor from 'open-editor'

export interface OpenInEditorOptions {
  /** Line number to jump to (1-indexed) */
  line?: number
  /** Column number to jump to (1-indexed) */
  column?: number
}

/**
 * Open a file in an editor and wait for it to close.
 * Returns when the user saves and closes the file.
 */
export async function openInEditor(filePath: string, options: OpenInEditorOptions = {}): Promise<void> {
  await openEditor(
    [
      {
        file: filePath,
        line: options.line,
        column: options.column,
      },
    ],
    { wait: true },
  )
}
