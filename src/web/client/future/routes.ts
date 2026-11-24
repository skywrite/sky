/**
 * `/future` is the area's Goals list and `/future/goals/<name>` one goal's page;
 * `/future/decisions` is the Decisions list, `/future/decisions/new` starts the
 * decision wizard, and `/future/decisions/new/<run>` is one run of it.
 */
export interface FutureRoute {
  /** The list the area shows */
  tab: 'goals' | 'decisions'
  /** The goal whose page is open, or null */
  goal: string | null
  /** The decision wizard */
  adding: boolean
  /** The wizard run that is open, or null at its start */
  run: string | null
}

export function futureRouteOf(path: string): FutureRoute | null {
  if (path !== '/future' && !path.startsWith('/future/')) return null
  const decisions = /^\/future\/decisions(\/|$)/.test(path)
  const wizard = path.match(/^\/future\/decisions\/new(?:\/([^/]+))?\/?$/)
  const route: FutureRoute = {
    tab: decisions ? 'decisions' : 'goals',
    goal: null,
    adding: Boolean(wizard),
    run: wizard?.[1] ?? null,
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

export const wizardHref = (run?: string): string => `/future/decisions/new${run ? `/${run}` : ''}`
