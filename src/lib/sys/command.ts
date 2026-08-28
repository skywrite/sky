/**
 * Utilities for working with external commands/executables
 * Uses node:child_process for cross-runtime compatibility (Deno, Node, Bun)
 */

import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

/**
 * Check if a command is available in the system PATH
 * @param commandName The name of the command to check
 * @returns True if the command exists and is executable
 */
export async function isCommandAvailable(commandName: string): Promise<boolean> {
  if (!commandName) return false
  try {
    await execFile('sh', ['-c', `command -v ${commandName}`])
    return true
  } catch {
    return false
  }
}

/**
 * Execute a command and return its output
 * @param commandName The command to execute
 * @param args Arguments to pass to the command
 * @param options Optional settings; `env` entries are merged over the current process env
 * @returns Object with success status, stdout, and stderr
 */
export async function runCommand(
  commandName: string,
  args: string[] = [],
  options: { env?: Record<string, string> } = {},
): Promise<{ success: boolean; code: number; stdout: string; stderr: string }> {
  try {
    const execOptions = options.env ? { env: { ...process.env, ...options.env } } : {}
    const { stdout, stderr } = await execFile(commandName, args, execOptions)

    return {
      success: true,
      code: 0,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
    }
  } catch (error) {
    // execFile rejects with an error that has code, stdout, stderr on failure
    const err = error as { code?: number | string; stdout?: string; stderr?: string; message?: string }
    // A process that never started (ENOENT, EBADF, EACCES…) rejects with a
    // string errno code and an empty — not absent — stderr, so the message is
    // its only account of what went wrong.
    const neverStarted = typeof err.code === 'string'
    return {
      success: false,
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: neverStarted ? (err.message ?? 'Unknown error') : (err.stderr ?? err.message ?? 'Unknown error'),
    }
  }
}

/**
 * Execute a command and parse JSON output
 * @param commandName The command to execute
 * @param args Arguments to pass to the command
 * @returns Parsed JSON output or null if command fails or output is invalid JSON
 */
export async function runCommandJSON<T = unknown>(commandName: string, args: string[] = []): Promise<T | null> {
  const result = await runCommand(commandName, args)

  if (!result.success) {
    return null
  }

  try {
    return JSON.parse(result.stdout) as T
  } catch {
    return null
  }
}

/**
 * Get the full path to a command
 * @param commandName The name of the command
 * @returns Full path to the command or null if not found
 */
export async function getCommandPath(commandName: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('sh', ['-c', `command -v ${commandName}`])

    const path = (stdout ?? '').trim()
    return path || null
  } catch {
    return null
  }
}
