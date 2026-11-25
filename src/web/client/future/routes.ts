/**
 * `/future` is the area's Goals list and `/future/goals/<name>` one goal's page;
 * `/future/decisions` is the Decisions list and `/future/decisions/<name>` one
 * decision's page; `/future/decisions/new` starts the decision wizard, and
 * `/future/decisions/new/<run>` is one run of it.
 */
export interface FutureRoute {
  /** The list the area shows */
  tab: 'goals' | 'decisions'
  /** The goal whose page is open, or null */
  goal: string | null
  /** The decision whose page is open, or null */
  decision: string | null
  /** The decision wizard */
  adding: boolean
  /** The wizard run that is open, or null at its start */
  run: string | null
}

const named = (segment: string | undefined): string | null => {
  if (!segment) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    // A mangled address still opens the area.
    return null
  }
}

export function futureRouteOf(path: string): FutureRoute | null {
  if (path !== '/future' && !path.startsWith('/future/')) return null
  const decisions = /^\/future\/decisions(\/|$)/.test(path)
  const wizard = path.match(/^\/future\/decisions\/new(?:\/([^/]+))?\/?$/)
  // `new` is the wizard's own address, so no decision's page answers to it.
  const decision = wizard ? undefined : path.match(/^\/future\/decisions\/([^/]+)\/?$/)?.[1]
  return {
    tab: decisions ? 'decisions' : 'goals',
    goal: named(path.match(/^\/future\/goals\/([^/]+)\/?$/)?.[1]),
    decision: named(decision),
    adding: Boolean(wizard),
    run: wizard?.[1] ?? null,
  }
}

export function goalHref(name: string): string {
  return `/future/goals/${encodeURIComponent(name)}`
}

export function decisionHref(name: string): string {
  return `/future/decisions/${encodeURIComponent(name)}`
}

export const wizardHref = (run?: string): string => `/future/decisions/new${run ? `/${run}` : ''}`
