/** Deterministic PRNG (mulberry32) so eval runs reproduce across sessions. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: T[], rand: () => number): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** Proportional-by-group sample: each group contributes ~its share of n, at least one. */
export function stratifiedSample<T>(items: T[], groupOf: (item: T) => string, n: number, rand: () => number): T[] {
  if (items.length <= n) return [...items]
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = groupOf(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  const picked: T[] = []
  for (const key of Array.from(groups.keys()).sort()) {
    const group = groups.get(key) as T[]
    const quota = Math.max(1, Math.round((n * group.length) / items.length))
    picked.push(...seededShuffle(group, rand).slice(0, quota))
  }
  return seededShuffle(picked, rand).slice(0, n)
}
