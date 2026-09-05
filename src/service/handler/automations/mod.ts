import { Hono } from 'hono'

/**
 * Automations — the machine's own jobs, read for the page at /automations.
 *
 * The page's data is one report: every charter in the notebook automations/
 * folder with its trigger, state and last run, plus the charters that could
 * not be read. It is the same picture `automations:status` prints, and the
 * production host builds it by running that command in-process, so the CLI
 * and the page can never disagree. This rung is read-only: the page shows
 * what runs; changing a charter is still done in the file.
 */

/** Whether a run changed anything — `nothing` is a result, not a failure */
export type AutomationOutcome = 'acted' | 'nothing' | 'failed'

export interface AutomationLastRun {
  /** `YYYY-MM-DD HH:MM` on the absolute frame */
  utc: string
  /** `YYYY-MM-DD HH:MM` on the charter's own clock */
  clock: string
  outcome: AutomationOutcome
  /** The firing this run answered, e.g. "EVERY-WEEKDAY 09:30" */
  target?: string
  /** Minutes between that firing and the run starting */
  lateMinutes?: number
  /** Failure detail, or a short note about what was done */
  message?: string
}

export interface AutomationRow {
  name: string
  /** The command the charter points at */
  run: string
  /** The trigger as written: "every 5m", "EVERY-WEEKDAY 07:15", "06:00, 11:00" */
  trigger: string
  /** "elapsed" for every:, else the zone — "local" or an IANA name */
  frame: string
  state: 'active' | 'paused' | 'expired'
  /** Owed a firing right now — the runner picks it up within a tick */
  due: boolean
  /** The charter body, verbatim */
  brief: string
  /** Frontmatter keys nothing reads — each one is probably a typo */
  unknownKeys: string[]
  /** The charter's path relative to the automations directory */
  file: string
  /** Recent runs, newest first, from the bounded ledger */
  runs: AutomationLastRun[]
  lastRun?: AutomationLastRun
}

export interface AutomationsReport {
  rows: AutomationRow[]
  /** Charters that could not be read, with the reason a person can fix */
  charterErrors: { path: string; error: string }[]
  /** Set when the run-state file was unusable; every charter then reads as never run */
  stateError?: string
  /** Where the charters live */
  dir: string
}

/** What one forced run amounted to */
export interface RunNowReport {
  outcome: AutomationOutcome
  message?: string
}

/** A model-drafted charter: validated, summarized, and not yet written */
export interface DraftReport {
  name: string
  contents: string
  run: string
  trigger: string
  frame: string
  brief: string
  revised: boolean
}

export type CreateOutcome = { kind: 'created' } | { kind: 'exists' } | { kind: 'invalid'; message: string }
export type SaveOutcome = { kind: 'saved' } | { kind: 'missing' } | { kind: 'invalid'; message: string }

export interface AutomationsRoutesOptions {
  /** The report, built fresh — production runs automations:status, tests script it */
  status: () => Promise<AutomationsReport>
  /** Flip a charter's status: line; false when no charter has that name */
  setStatus: (name: string, status: 'active' | 'paused') => Promise<boolean>
  /**
   * Run one charter now, whether or not it is due — automations:run without a
   * stamp, so a forced run never moves the schedule. Null when no charter has
   * that name; a run that failed is a report, not an error.
   */
  runNow: (name: string) => Promise<RunNowReport | null>
  /**
   * Draft a charter from a plain-words request — automations:draft, a model
   * call away. With `revise`, rewrites that existing charter instead. Throws
   * with a person-readable message when the draft cannot be produced.
   */
  draft: (request: string, revise?: string) => Promise<DraftReport>
  /** Write a drafted charter as a new file; never overwrites */
  create: (name: string, contents: string) => Promise<CreateOutcome>
  /** Overwrite one existing charter with revised contents */
  save: (name: string, contents: string) => Promise<SaveOutcome>
}

export function createAutomationRoutes(options: AutomationsRoutesOptions): Hono {
  const app = new Hono()

  app.get('/status', async (c) => {
    try {
      return c.json(await options.status())
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/automation/:name/status', async (c) => {
    const name = c.req.param('name')
    const body = (await c.req.json().catch(() => null)) as { status?: unknown } | null
    const status = body?.status
    if (status !== 'active' && status !== 'paused') {
      return c.json({ message: 'status must be "active" or "paused"' }, 400)
    }
    try {
      const found = await options.setStatus(name, status)
      if (!found) return c.json({ message: `No automation named "${name}".` }, 404)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/automation/:name/run', async (c) => {
    const name = c.req.param('name')
    try {
      const report = await options.runNow(name)
      if (!report) return c.json({ message: `No automation named "${name}".` }, 404)
      return c.json(report)
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/draft', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { request?: unknown; revise?: unknown } | null
    const request = typeof body?.request === 'string' ? body.request.trim() : ''
    const revise = typeof body?.revise === 'string' && body.revise ? body.revise : undefined
    if (!request) return c.json({ message: 'Missing required field: request' }, 400)
    try {
      return c.json(await options.draft(request, revise))
    } catch (err) {
      // The drafter is a model call away; its failure is upstream of this route.
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  app.post('/create', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown; contents?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name : ''
    const contents = typeof body?.contents === 'string' ? body.contents : ''
    if (!name || !contents) return c.json({ message: 'Missing required fields: name, contents' }, 400)
    try {
      const outcome = await options.create(name, contents)
      if (outcome.kind === 'exists') return c.json({ message: `A charter named "${name}" already exists.` }, 409)
      if (outcome.kind === 'invalid') return c.json({ message: outcome.message }, 400)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/automation/:name/save', async (c) => {
    const name = c.req.param('name')
    const body = (await c.req.json().catch(() => null)) as { contents?: unknown } | null
    const contents = typeof body?.contents === 'string' ? body.contents : ''
    if (!contents) return c.json({ message: 'Missing required field: contents' }, 400)
    try {
      const outcome = await options.save(name, contents)
      if (outcome.kind === 'missing') return c.json({ message: `No automation named "${name}".` }, 404)
      if (outcome.kind === 'invalid') return c.json({ message: outcome.message }, 400)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  return app
}
