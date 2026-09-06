/**
 * What the service is in the middle of — the turns, imports, and runs a
 * restart would kill. Whoever starts one takes a hold and releases it when
 * done; the reload gate asks what is held before it lets the process go,
 * and hears each release so a pending restart lands the moment the last
 * hold lets go. A hold with a lifetime covers work the service only sees
 * the edges of, like a voice conversation running in the browser.
 */

const held = new Map<number, string>()
const timed = new Map<string, { id: number; timer: ReturnType<typeof setTimeout> }>()
const listeners = new Set<() => void>()
let next = 0

function take(label: string): number {
  const id = ++next
  held.set(id, label)
  return id
}

function drop(id: number): void {
  if (!held.delete(id)) return
  for (const listener of listeners) listener()
}

/** Take a hold for `label`; call the returned function once when the work is done. Calling it twice is harmless. */
export function hold(label: string): () => void {
  const id = take(label)
  return () => drop(id)
}

/**
 * Hold for `label` under `key` for `ms` more — a touch renews it, so work
 * the service hears from in bursts stays held while the bursts keep coming
 * and lets go `ms` after the last one. Zero releases at once.
 */
export function touch(key: string, label: string, ms: number): void {
  const current = timed.get(key)
  if (current) {
    clearTimeout(current.timer)
    timed.delete(key)
    if (ms <= 0) {
      drop(current.id)
      return
    }
    timed.set(key, { id: current.id, timer: setTimeout(() => expire(key), ms) })
    return
  }
  if (ms <= 0) return
  timed.set(key, { id: take(label), timer: setTimeout(() => expire(key), ms) })
}

function expire(key: string): void {
  const current = timed.get(key)
  if (!current) return
  timed.delete(key)
  drop(current.id)
}

/** The labels of everything held right now, oldest first. */
export function holding(): string[] {
  return [...held.values()]
}

/** Hear every release; returns the function that stops listening. */
export function onRelease(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
