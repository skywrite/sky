/**
 * Output handler module for task output abstraction.
 *
 * This module provides different output handlers for tasks:
 * - ConsoleOutput: Default handler that outputs to console
 * - BufferedOutput: Testing handler that captures output in memory
 */

export type { OutputHandler } from './OutputHandler.ts'
export { ConsoleOutput } from './ConsoleOutput.ts'
export { BufferedOutput } from './BufferedOutput.ts'

import { BufferedOutput } from './BufferedOutput.ts'
import { ConsoleOutput } from './ConsoleOutput.ts'

/**
 * Create a default output handler for production use
 */
export function createDefaultOutput() {
  return new ConsoleOutput()
}

/**
 * Create a buffered output handler for testing
 */
export function createTestOutput() {
  return new BufferedOutput()
}
