import colors from 'picocolors'
import { writeStdout } from '#shared/sys/mod.ts'
import type { OutputHandler } from './OutputHandler.ts'

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
