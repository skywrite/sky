/**
 * Utility functions for calculating VSCode text ranges for completions.
 */

import * as vscode from 'vscode'

/**
 * Create a range that replaces text before the cursor position.
 * Used to replace partial text with the full completion item.
 *
 * @param position - Current cursor position
 * @param textLength - Length of text to replace (going backwards from position)
 * @returns VSCode Range for the replacement
 *
 * @example
 * // If cursor is after "Ver" at position 15
 * // and we want to replace "Ver" with "Vertex/AI"
 * createReplacementRange(position, 3)
 * // Returns range from position 12 to 15
 */
export function createReplacementRange(
  position: vscode.Position,
  textLength: number
): vscode.Range {
  const startPos = position.translate(0, -textLength)
  return new vscode.Range(startPos, position)
}
