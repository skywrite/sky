import * as path from 'node:path'
import gatherWeekSummaries from '#commands/all/summary/lib/gatherWeekSummaries.ts'
import { exists } from '#shared/fs/mod.ts'
import { dayDir, weekDir } from '#shared/nbfs/mod.ts'
import { PlainDate, type Week } from '#universal/dates/nbdt/mod.ts'
import { hold } from '../../activity.ts'

export type SummarizeWeek = (week: Week, options: { allowMissing: boolean }) => Promise<void>

export interface WeekSummaryView {
  week: string
  complete: boolean
  enabled: boolean
  path: string | null
  availableDays: number
  missing: Array<{ day: string; weekday: string; reason: string; path: string | null }>
  running: boolean
  error: string | null
}

interface Options {
  markdownBaseDir: string
  timeDir: string
  today: () => PlainDate
  summarize?: SummarizeWeek
}

export class WeekSummaryError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 501,
  ) {
    super(message)
  }
}

/** The service owns generation, so closing the page does not interrupt a summary. */
export class WeekSummaries {
  private readonly jobs = new Map<string, { running: boolean; error: string | null }>()

  constructor(private readonly options: Options) {}

  private file(week: Week): string {
    return path.join(this.options.timeDir, weekDir(week.startInYear), 'summary.md')
  }

  async read(week: Week): Promise<WeekSummaryView> {
    const { markdownBaseDir, timeDir, today, summarize } = this.options
    const { days, skipped } = await gatherWeekSummaries(week.days, timeDir)
    const reasons = {
      missing: 'No daily summary yet',
      tiny: 'The daily summary is too short to use',
      yamlError: 'The daily summary has invalid frontmatter',
      unreadable: 'The daily summary could not be read',
    }
    const missing = Object.entries(skipped).flatMap(([reason, dates]) =>
      dates.map((day) => ({
        day: day.ymd,
        weekday: day.dayLong,
        reason: reasons[reason as keyof typeof reasons],
        path:
          reason === 'missing' ? null : path.relative(markdownBaseDir, path.join(timeDir, dayDir(day), 'summary.md')),
      })),
    )
    const saved = await exists(this.file(week))
    const job = this.jobs.get(week.toString())
    return {
      week: week.toString(),
      complete: PlainDate.compare(week.end, today()) < 0,
      enabled: Boolean(summarize),
      path: saved ? path.relative(markdownBaseDir, this.file(week)) : null,
      availableDays: days.length,
      missing: missing.sort((a, b) => a.day.localeCompare(b.day)),
      running: job?.running ?? false,
      error: saved ? null : (job?.error ?? null),
    }
  }

  async start(week: Week, allowMissing: boolean): Promise<{ status: 200 | 202; view: WeekSummaryView }> {
    const id = week.toString()
    if (this.jobs.get(id)?.running) return { status: 202, view: await this.read(week) }

    // Reserve before the first file read: two tabs cannot launch duplicate model calls.
    const job = { running: true, error: null as string | null }
    this.jobs.set(id, job)
    const release = hold(`summarizing week ${id}`)
    try {
      const view = await this.read(week)
      if (view.path) {
        job.running = false
        release()
        return { status: 200, view: { ...view, running: false } }
      }
      if (!view.complete)
        throw new WeekSummaryError(`Week ${id} has not ended. Generate its summary after ${week.end.ymd}.`, 409)
      const summarize = this.options.summarize
      if (!summarize) throw new WeekSummaryError('Weekly summary generation is unavailable in this service.', 501)
      if (!view.availableDays)
        throw new WeekSummaryError(`Week ${id} has no usable daily summaries. Review and summarize a day first.`, 409)
      if (view.missing.length && !allowMissing)
        throw new WeekSummaryError(
          `Week ${id} needs daily summaries for ${view.missing.map((day) => day.day).join(', ')}. ` +
            'Review those days or choose to generate with the available daily summaries.',
          409,
        )

      void Promise.resolve()
        .then(() => summarize(week, { allowMissing }))
        .then(async () => {
          if (!(await exists(this.file(week)))) throw new Error('No weekly summary was saved. Try again.')
        })
        .catch((error: unknown) => {
          job.error = `Could not summarize week ${id}: ${error instanceof Error ? error.message : String(error)}`
        })
        .finally(() => {
          job.running = false
          release()
        })
      return { status: 202, view }
    } catch (error) {
      job.running = false
      release()
      throw error
    }
  }
}
