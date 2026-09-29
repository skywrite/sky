let pending: Promise<void> = Promise.resolve()

/** The desktop SDK bridge fails with IPC -4 on overlapping requests, even across accounts. */
export function onePasswordRequest<T>(request: () => Promise<T>): Promise<T> {
  const result = pending.then(request)
  // Keep failures from blocking later requests, and do not retain credential results in the queue.
  pending = result.then(
    () => {},
    () => {},
  )
  return result
}
