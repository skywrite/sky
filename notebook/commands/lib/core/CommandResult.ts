/**
 * Command result structure (JSend-inspired)
 *
 * - success: The operation completed successfully
 * - fail: The operation failed due to invalid input or business logic
 * - error: The operation failed due to an unexpected error
 *
 * Use `.ok` getter for cleaner checks:
 *   if (result.ok) { ... }
 *   if (!result.ok) { return result }
 */
export class CommandResult<T = unknown> {
  readonly status: 'success' | 'fail' | 'error'
  readonly data?: T
  readonly message?: string
  readonly error?: Error

  private constructor(status: 'success' | 'fail' | 'error', data?: T, message?: string, error?: Error) {
    this.status = status
    this.data = data
    this.message = message
    this.error = error
  }

  /**
   * Returns true if the result is a success.
   * Use this for cleaner conditionals: `if (result.ok) { ... }`
   */
  get ok(): boolean {
    return this.status === 'success'
  }

  /**
   * Returns true if the result is a fail (business logic failure).
   * Use `!result.ok` to check for any non-success (fail OR error).
   */
  get failed(): boolean {
    return this.status === 'fail'
  }

  /**
   * Create a success result
   */
  static success<T>(data?: T, message?: string): CommandResult<T> {
    return new CommandResult('success', data, message)
  }

  /**
   * Create a fail result (business logic failure)
   */
  static fail<T = never>(message: string, data?: T): CommandResult<T> {
    return new CommandResult('fail', data, message)
  }

  /**
   * Create an error result (unexpected error)
   */
  static error<T = never>(error: Error | string, message?: string): CommandResult<T> {
    const err = typeof error === 'string' ? new Error(error) : error
    return new CommandResult<T>('error', undefined as T | undefined, message || err.message, err)
  }
}

/**
 * Type guards for task results
 */
export function isSuccess<T>(result: CommandResult<T>): result is CommandResult<T> & { status: 'success' } {
  return result.status === 'success'
}

export function isFail<T>(result: CommandResult<T>): result is CommandResult<T> & { status: 'fail' } {
  return result.status === 'fail'
}

export function isError<T>(result: CommandResult<T>): result is CommandResult<T> & { status: 'error' } {
  return result.status === 'error'
}

export function isFailOrError<T>(result: CommandResult<T>): result is CommandResult<T> & { status: 'fail' | 'error' } {
  return result.status === 'fail' || result.status === 'error'
}
