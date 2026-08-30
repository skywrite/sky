/**
 * The undo stack (architecture §9): commands on the model, never the browser's. A typing command
 * holds one leaf's text before and after a run of keystrokes; a range command holds the JSON of
 * the top-level blocks between two anchors before and after a structural step. Each side carries
 * the caret to put back.
 */

import type { Bookmark } from './bookmark.ts'
import type { NodeJson } from './model.ts'

export interface Anchors {
  before: string | null
  after: string | null
}

export type Command =
  | {
      kind: 'text'
      id: string
      before: { text: string; cursor: Bookmark | null }
      after: { text: string; cursor: Bookmark | null }
    }
  | {
      kind: 'range'
      anchors: Anchors
      before: NodeJson[]
      after: NodeJson[]
      cursorBefore: Bookmark | null
      cursorAfter: Bookmark | null
    }

/** How many steps the stack keeps (UND-9); a whole-document step weighs as several. */
const CAPACITY = 120

export class History {
  private commands: Command[] = []
  /** Commands before this index are undoable; from it on, redoable. */
  private index = 0

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.commands.length
  }

  /** Records a step, discarding any redo history (UND-8). */
  push(command: Command) {
    this.commands.length = this.index
    this.commands.push(command)
    this.index = this.commands.length
    let weight = 0
    for (let i = this.commands.length - 1; i >= 0; i--) {
      weight += this.weightOf(this.commands[i]!)
      if (weight > CAPACITY) {
        this.commands.splice(0, i + 1)
        this.index = this.commands.length
        break
      }
    }
  }

  /** The step to reverse, or null; the caller applies its `before` side. */
  undo(): Command | null {
    if (!this.canUndo) return null
    this.index--
    return this.commands[this.index]!
  }

  /** The step to replay, or null; the caller applies its `after` side. */
  redo(): Command | null {
    if (!this.canRedo) return null
    const command = this.commands[this.index]!
    this.index++
    return command
  }

  /** The most recent undoable step, for extending a run of typing. */
  get last(): Command | null {
    return this.index > 0 ? (this.commands[this.index - 1] ?? null) : null
  }

  clear() {
    this.commands = []
    this.index = 0
  }

  private weightOf(command: Command): number {
    if (command.kind === 'text') return 1
    return Math.max(1, Math.ceil(command.after.length / 4))
  }
}
