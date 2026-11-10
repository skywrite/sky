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

/**
 * The kernel's last sleep and last wake, as `sysctl -n kern.sleeptime kern.waketime` prints them, read as the
 * wake in epoch milliseconds: 0 when the Mac has not slept since boot. Null for output it cannot read, and
 * while the sleep is the later of the two: a reading taken before the wake was stamped.
 */
export function parseDarwinWakeMs(stdout: string): number | null {
  const times = [...stdout.matchAll(/sec = (\d+), usec = (\d+)/g)].map(
    (match) => Number(match[1]) * 1000 + Math.floor(Number(match[2]) / 1000),
  )
  if (times.length !== 2) return null
  const [slept, woke] = times
  return slept > woke ? null : woke
}

/**
 * Get when the Mac last woke from sleep, in epoch milliseconds (macOS only).
 * A closed Mac wakes itself in the background every few minutes, and those wakes count: the time of the
 * latest one is what tells a key press made since from an idle timer that merely stopped while asleep.
 * Returns null if the command fails (e.g. not on macOS) or the Mac is mid-wake.
 */
export async function getDarwinWakeMs(): Promise<number | null> {
  const result = await runCommand('/usr/sbin/sysctl', ['-n', 'kern.sleeptime', 'kern.waketime'])
  return result.success ? parseDarwinWakeMs(result.stdout) : null
}
