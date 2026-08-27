/**
 * OutputHandler interface for abstracting console output in tasks.
 * This allows tasks to output through different handlers for testing,
 * formatting, or redirection purposes.
 */
export interface OutputHandler {
  /**
   * Log a message (equivalent to console.log)
   */
  log(message: string): void

  /**
   * Write text without ending the line — output that arrives in pieces
   * (a streamed reply). The next log continues the same line.
   */
  write(text: string): void

  /**
   * Log an error message (equivalent to console.error)
   */
  error(message: string): void

  /**
   * Display data in a table format (equivalent to console.table)
   */
  table(data: any): void

  /**
   * Log task start (optional - may be no-op in some implementations)
   */
  commandStart?(): void

  /**
   * Log task completion with status (optional - may be no-op in some implementations)
   */
  commandEnd?(status: 'success' | 'fail' | 'error'): void

  /**
   * Create a child output handler with increased indentation level.
   *
   * Used by CommandService to create nested output for subtasks, maintaining
   * a visual hierarchy in the output:
   *
   * @example
   * ```
   * [day:start] Starting day...
   *   [day:sr-update] Updating spaced repetition...
   *   [util:weather] Fetching weather...
   *     [api:fetch] Making HTTP request...
   * ```
   *
   * Implementation notes:
   * - Should increase indentation by one level (typically 2 spaces)
   * - Should preserve all other output handler behavior
   * - May optionally update task name prefix
   * - Optional method - handlers that don't support nesting can omit this
   *
   * @param commandName - Optional task name for the child handler's prefix
   * @returns A new OutputHandler instance with increased indentation
   */
  child?(commandName?: string): OutputHandler
}
