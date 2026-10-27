export interface ViewVersion {
  instance: string
  sequence: number
}

// This identifies a service lifetime, not user content. A restart begins a new sequence.
export const serviceInstance = crypto.randomUUID()
let sequence = 0

/** Allocate before reading: a slow old read must not outrank a later save's response. */
export function nextViewVersion(): ViewVersion {
  return { instance: serviceInstance, sequence: ++sequence }
}
