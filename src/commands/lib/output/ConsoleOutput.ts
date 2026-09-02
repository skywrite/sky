import colors from 'picocolors'
import { writeStdout } from '#shared/sys/mod.ts'
import type { OutputHandler, PlanStep } from './OutputHandler.ts'

/**
 * Default output handler that passes through to console.
 * This maintains the current behavior for production use.
 */
export class ConsoleOutput implements OutputHandler {
  private commandName?: string
  private disablePrefix: boolean
  private indentLevel: number

  constructor(commandName?: string, disablePrefix = true, indentLevel = 0) {
    this.commandName = commandName
    this.disablePrefix = disablePrefix
    this.indentLevel = indentLevel
  }

  private formatPrefix(): string {
    if (!this.commandName || this.disablePrefix) return ''
    // Bold cyan for the task name prefix
    return colors.bold(colors.cyan(`[${this.commandName}]`)) + ' '
  }

  private formatIndent(): string {
    return '  '.repeat(this.indentLevel)
  }

  log(message: string): void {
    console.log(this.formatIndent() + this.formatPrefix() + message)
  }

  /** Raw: indent and prefix decorate line starts, which a partial write does not track. */
  write(text: string): void {
    writeStdout(text)
  }

  error(message: string): void {
    // Red color for error messages
    const errorMessage = this.disablePrefix ? message : colors.red(message)
    console.error(this.formatIndent() + this.formatPrefix() + errorMessage)
  }

  table(data: any): void {
    // For table output, we don't add the prefix since console.table handles its own formatting
    console.table(data)
  }

  /** The terminal shows steps as they come; the list up front would only repeat them. */
  plan(_steps: PlanStep[]): void {}

  /** One line per step, the way the phases have always read here. */
  stage(_id: string, label: string, detail?: string): void {
    const suffix = detail ? colors.dim(` · ${detail}`) : ''
    console.log(`\n${this.formatIndent()}${this.formatPrefix()}${colors.cyan(label)}${suffix}`)
  }

  /** In place while a terminal is watching; one closing line otherwise. */
  tick(done: number, total: number | null, unit?: string): void {
    const count = total === null ? `${done}` : `${done} of ${total}`
    const text = `${this.formatIndent()}  ${count}${unit ? ` ${unit}` : ''}`
    if (process.stdout.isTTY) {
      writeStdout(`\r${text}${total !== null && done >= total ? '\n' : ''}`)
    } else if (total === null || done >= total) {
      console.log(text)
    }
  }

  commandStart(): void {
    if (!this.disablePrefix && this.commandName) {
      console.log(this.formatIndent() + this.formatPrefix() + colors.dim('Starting...'))
    }
  }

  commandEnd(status: 'success' | 'fail' | 'error'): void {
    if (!this.disablePrefix && this.commandName) {
      const statusColor = status === 'success' ? colors.green : colors.red
      const statusText = status === 'success' ? '✓ Completed' : '✗ Failed'
      console.log(this.formatIndent() + this.formatPrefix() + statusColor(statusText))
    }
  }

  /**
   * Create a child output handler with increased indentation.
   *
   * This creates a new ConsoleOutput instance with:
   * - Indentation increased by one level (2 spaces)
   * - Same prefix settings (disablePrefix)
   * - Optional new task name for prefix
   *
   * Used by CommandService to create nested output for subtasks.
   *
   * @param commandName - Optional task name for the child's prefix
   * @returns New ConsoleOutput instance with increased indentation
   */
  child(commandName?: string): OutputHandler {
    return new ConsoleOutput(commandName ?? this.commandName, this.disablePrefix, this.indentLevel + 1)
  }
}
