/**
 * Detect user idle time via macOS IOKit HIDIdleTime
 */

import { runCommand } from './command.ts'

/**
 * Get milliseconds since last keyboard/mouse/trackpad input (macOS only).
 * Returns null if the command fails (e.g. not on macOS).
 */
export async function getDarwinIdleMs(): Promise<number | null> {
  const result = await runCommand('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4'])
  if (!result.success) return null

  const match = result.stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/)
  if (!match) return null

  return Math.floor(Number(match[1]) / 1_000_000)
}
