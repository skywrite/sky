import { setTimeout as delay } from 'node:timers/promises'
import { calendarInstant, instantNow } from '#universal/dates/nbdt/mod.ts'
import type { CalendarJob, CalendarPreparation, CalendarRequest, CalendarReview } from './types.ts'
import type { CalendarUpdateRequest, CalendarUpdatePreparation, CalendarUpdateReview } from './updateTypes.ts'

/** Command transport; durable work stays with the service when the caller disconnects. */
export class CalendarSchedulerClient {
  constructor(private readonly origin: string) {}

  private async request<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(60_000)
    let response: Response
    try {
      response = await fetch(`${this.origin}/calendar/_api${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new Error(
        `Could not reach the calendar scheduler at ${this.origin}. Check that the Sky service is running.`,
        { cause: error },
      )
    }
    const result = await response.json().catch(() => {
      throw new Error('The Sky service did not return a calendar result. It may need to reload the updated code.')
    })
    if (!response.ok) throw new Error(result.message ?? `Calendar request failed (${response.status}).`)
    return result as T
  }

  prepare(request: CalendarRequest, signal?: AbortSignal): Promise<CalendarPreparation> {
    return this.request('/prepare', request, signal)
  }

  review(review: CalendarReview, signal?: AbortSignal): Promise<CalendarPreparation> {
    return this.request('/review', review, signal)
  }

  send(draftId: string, signal?: AbortSignal): Promise<CalendarJob> {
    return this.request('/send', { draftId }, signal)
  }

  get(id: string, signal?: AbortSignal): Promise<CalendarJob> {
    return this.request(`/jobs/${encodeURIComponent(id)}`, undefined, signal)
  }

  prepareUpdate(request: CalendarUpdateRequest, signal?: AbortSignal): Promise<CalendarUpdatePreparation> {
    return this.request('/updates/prepare', request, signal)
  }

  reviewUpdate(review: CalendarUpdateReview, signal?: AbortSignal): Promise<CalendarUpdatePreparation> {
    return this.request('/updates/review', review, signal)
  }

  update(draftId: string, signal?: AbortSignal): Promise<CalendarJob> {
    return this.request('/update', { draftId }, signal)
  }

  async wait(job: CalendarJob, signal?: AbortSignal): Promise<CalendarJob> {
    const deadline = calendarInstant(instantNow()) + 360_000
    while ((job.state === 'creating' || job.state === 'updating') && calendarInstant(instantNow()) < deadline) {
      await delay(500, undefined, { signal })
      job = await this.get(job.id, signal)
    }
    return job
  }
}
