import { Hono } from 'hono'

/**
 * The clock — notebook time against the world's.
 *
 * The page's data: one snapshot of the two clocks the notebook lives
 * between, and one conversion. The snapshot is built fresh per request;
 * notebook now is the last started day in that day's own zone, with
 * hours running past 24 until the next day:start — exactly as every
 * command sees it. Enter on the page sends the raw line to
 * util:tz:convert; the model classifies it there, so the route is a
 * relay, not a parser.
 */

/** One clock on the wire: a wall-clock reading in a zone. */
export interface ClockReading {
  /** `YYYY-MM-DD` — for the notebook, the day it is still on */
  date: string
  /** `HH:MM` — notebook hours may exceed 23; `32:07` is the morning after an unstarted day */
  time: string
  /** IANA zone */
  timezone: string
}

export interface ClockSnapshot {
  notebook: ClockReading
  system: ClockReading
}

/** util:tz:convert's three rows, as the CLI prints them. */
export interface ConvertAnswer {
  local: ClockReading
  target: ClockReading & {
    /** The requested place, independent of the city named by the IANA timezone. */
    place: string
  }
  utc: ClockReading
}

export interface ClockRoutesOptions {
  /** The two clocks, read fresh — production asks the notebook, tests script it */
  now: () => ClockSnapshot
  /** One util:tz:convert run; throws with a person-readable message when the line cannot be read */
  convert: (query: string) => Promise<ConvertAnswer>
}

export function createClockRoutes(options: ClockRoutesOptions): Hono {
  const app = new Hono()

  app.get('/now', (c) => {
    try {
      return c.json(options.now())
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/convert', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { query?: unknown } | null
    const query = typeof body?.query === 'string' ? body.query.trim() : ''
    if (!query) return c.json({ message: 'Missing required field: query' }, 400)
    try {
      return c.json(await options.convert(query))
    } catch (err) {
      // The converter is a model call away; its failure is upstream of this route.
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  return app
}
