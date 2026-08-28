/**
 * Count the file descriptors this process holds.
 */

import { readdirSync } from 'node:fs'

/**
 * Number of file descriptors open in this process, or null where the
 * per-process descriptor directory is unavailable. `/dev/fd` enumerates the
 * calling process's own descriptors on macOS and Linux (where it links to
 * /proc/self/fd). The readdir briefly holds one entry itself, so the count
 * reads at most one high. Spawns no child process — which is what keeps it
 * usable when spawning is the very thing that has broken.
 */
export function openFdCount(): number | null {
  try {
    return readdirSync('/dev/fd').length
  } catch {
    return null
  }
}
