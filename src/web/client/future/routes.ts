/**
 * `/future` is the area's Goals list and `/future/goals/<name>` one goal's page;
 * `/future/decisions` is the Decisions list and `/future/decisions/new` the page that adds one.
 */
export interface FutureRoute {
  /** The list the area shows */
  tab: 'goals' | 'decisions'
  /** The goal whose page is open, or null */
  goal: string | null
  /** The page that adds a decision */
  adding: boolean
}

export function futureRouteOf(path: string): FutureRoute | null {
  if (path !== '/future' && !path.startsWith('/future/')) return null
  const decisions = /^\/future\/decisions(\/|$)/.test(path)
  const route: FutureRoute = {
    tab: decisions ? 'decisions' : 'goals',
    goal: null,
    adding: /^\/future\/decisions\/new\/?$/.test(path),
  }
  const name = path.match(/^\/future\/goals\/([^/]+)\/?$/)?.[1]
  if (!name) return route
  try {
    return { ...route, goal: decodeURIComponent(name) }
  } catch {
    // A mangled address still opens the area.
    return route
  }
}

export function goalHref(name: string): string {
  return `/future/goals/${encodeURIComponent(name)}`
}
