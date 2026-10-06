/**
 * The owner's email addresses for the day page, kept between refreshes.
 * Asking Gmail takes a moment and can fail, and the page asks on every
 * refresh: the answer is reused for ten minutes, a refresh waits for a
 * pending answer only briefly, and a failed ask keeps what was known.
 */

const RELOAD_MS = 10 * 60_000
const WAIT_MS = 2_000

export function keptOwnerAddresses(
  load: () => Promise<string[]>,
  options: { reloadMs?: number; waitMs?: number; now?: () => number } = {},
): () => Promise<string[]> {
  const reloadMs = options.reloadMs ?? RELOAD_MS
  const waitMs = options.waitMs ?? WAIT_MS
  const now = options.now ?? (() => performance.now())
  let known: string[] = []
  let askedAt: number | null = null
  let asking: Promise<string[]> | null = null

  return async () => {
    if (!asking && (askedAt === null || now() - askedAt >= reloadMs)) {
      askedAt = now()
      asking = load()
        .then((addresses) => (known = addresses))
        .catch(() => known)
        .finally(() => {
          asking = null
        })
    }
    if (!asking) return known
    let timer: ReturnType<typeof setTimeout> | undefined
    const waited = new Promise<string[]>((resolve) => {
      timer = setTimeout(() => resolve(known), waitMs)
    })
    try {
      return await Promise.race([asking, waited])
    } finally {
      clearTimeout(timer)
    }
  }
}
