/** `/future` is the area's Goals view; `/future/goals/<name>` is one goal's page. */
export interface FutureRoute {
  /** The goal whose page is open, or null on the Goals view */
  goal: string | null
}

export function futureRouteOf(path: string): FutureRoute | null {
  if (path !== '/future' && !path.startsWith('/future/')) return null
  const name = path.match(/^\/future\/goals\/([^/]+)\/?$/)?.[1]
  if (!name) return { goal: null }
  try {
    return { goal: decodeURIComponent(name) }
  } catch {
    // A mangled address still opens the area.
    return { goal: null }
  }
}

export function goalHref(name: string): string {
  return `/future/goals/${encodeURIComponent(name)}`
}
