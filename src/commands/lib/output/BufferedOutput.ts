import type { OutputHandler, PlanStep } from './OutputHandler.ts'

/**
 * Output handler that buffers messages in memory.
 * Useful for testing and capturing output without console pollution.
 */
export class BufferedOutput implements OutputHandler {
  private logs: string[] = []
  private errors: string[] = []
  private tables: any[] = []
  private plans: PlanStep[][] = []
  private stages: { id: string; label: string; detail: string | null }[] = []
  private ticks: { done: number; total: number | null; unit: string | null }[] = []
  /** The line in progress: written pieces the next log will complete. */
  private partial = ''
  private indentLevel: number

  constructor(indentLevel = 0) {
    this.indentLevel = indentLevel
  }

  private formatIndent(): string {
    return '  '.repeat(this.indentLevel)
  }

  log(message: string): void {
    this.logs.push(this.formatIndent() + this.partial + message)
    this.partial = ''
  }

  write(text: string): void {
    this.partial += text
  }

  error(message: string): void {
    this.errors.push(this.formatIndent() + message)
  }

  table(data: any): void {
    this.tables.push(data)
  }

  plan(steps: PlanStep[]): void {
    this.plans.push(steps)
  }

  stage(id: string, label: string, detail?: string): void {
    this.stages.push({ id, label, detail: detail ?? null })
  }

  tick(done: number, total: number | null, unit?: string): void {
    this.ticks.push({ done, total, unit: unit ?? null })
  }

  /** The plans announced, in order */
  getPlans(): PlanStep[][] {
    return this.plans.map((p) => [...p])
  }

  /** The steps reported, in order — what a test asserts a run walked through */
  getStages(): { id: string; label: string; detail: string | null }[] {
    return [...this.stages]
  }

  getTicks(): { done: number; total: number | null; unit: string | null }[] {
    return [...this.ticks]
  }

  /**
   * Get all logged messages, plus the line still in progress if any
   */
  getLogs(): string[] {
    return this.partial ? [...this.logs, this.formatIndent() + this.partial] : [...this.logs]
  }

  /**
   * Get all error messages
   */
  getErrors(): string[] {
    return [...this.errors]
  }

  /**
   * Get all table data
   */
  getTables(): any[] {
    return [...this.tables]
  }

  /**
   * Get all output (logs and errors) in order
   */
  getAll(): { type: 'log' | 'error'; message: string }[] {
    const all: { type: 'log' | 'error'; message: string }[] = []

    // Note: This doesn't preserve exact ordering between logs and errors,
    // but provides a simple interface for testing
    for (const message of this.getLogs()) {
      all.push({ type: 'log', message })
    }
    for (const message of this.errors) {
      all.push({ type: 'error', message })
    }

    return all
  }

  /**
   * Clear all buffered output
   */
  clear(): void {
    this.logs = []
    this.errors = []
    this.tables = []
    this.plans = []
    this.stages = []
    this.ticks = []
    this.partial = ''
  }

  /**
   * Check if any logs contain the given text
   */
  hasLog(text: string): boolean {
    return this.logs.some((log) => log.includes(text))
  }

  /**
   * Check if any errors contain the given text
   */
  hasError(text: string): boolean {
    return this.errors.some((error) => error.includes(text))
  }

  /**
   * No-op for buffered output
   */
  commandStart(): void {
    // Could log this if needed for testing
  }

  /**
   * No-op for buffered output
   */
  commandEnd(_status: 'success' | 'fail' | 'error'): void {
    // Could log this if needed for testing
  }

  /**
   * Create a child output handler with increased indentation.
   *
   * This creates a new BufferedOutput instance with:
   * - Indentation increased by one level (2 spaces)
   * - Separate buffer from parent (isolation for testing)
   *
   * Used by CommandService to create nested output for subtasks.
   *
   * @param _commandName - Command name (unused in BufferedOutput, but part of interface)
   * @returns New BufferedOutput instance with increased indentation
   */
  child(_commandName?: string): OutputHandler {
    return new BufferedOutput(this.indentLevel + 1)
  }
}
