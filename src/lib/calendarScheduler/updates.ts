import { z } from 'zod'
import { calendarNow, instantNow, PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { CalendarDrafts } from './drafts.ts'
import type { CalendarSchedulerHost } from './types.ts'
import type { CalendarUpdatePreparation, CalendarUpdateRequest, CalendarEventSnapshot } from './updateTypes.ts'
import { eventFieldsSchema, eventRefSchema, requireEditable, validateEventUpdate } from './updateValidation.ts'

const requestSchema = z
  .object({
    request: z.string().trim().min(1).max(4000),
    account: z.string().trim().min(1).max(254).optional(),
    timezone: z.string().min(1).max(100).optional(),
    event: eventRefSchema.optional(),
  })
  .strict()

const empty = (): CalendarUpdatePreparation => ({
  status: 'needs_input',
  candidates: [],
  addGuests: [],
  removeGuests: [],
  assumptions: [],
  questions: [],
  requestQuestions: [],
  unsupported: [],
  warnings: [],
})

/** Updating starts with the provider's event, never a new-meeting template. */
export class CalendarUpdates {
  constructor(
    private readonly host: CalendarSchedulerHost,
    private readonly drafts: CalendarDrafts,
    private readonly now: () => string = instantNow,
  ) {}

  private get provider() {
    if (!this.host.updates) throw new Error('This calendar provider does not support event updates.')
    return this.host.updates
  }

  async prepare(input: CalendarUpdateRequest, signal?: AbortSignal): Promise<CalendarUpdatePreparation> {
    const request = requestSchema.parse(input)
    const setup = await this.host.setup()
    const timezone = request.timezone ?? setup.timezone
    calendarNow(timezone)
    const wanted = request.account?.toLowerCase()
    const accounts = setup.accounts.map((account) => account.toLowerCase())
    const matches = accounts.includes(wanted ?? '')
      ? [wanted!]
      : accounts.filter((account) => !wanted || account.includes(wanted))
    const result = empty()
    if (!matches.length) {
      result.questions = [
        wanted
          ? `No connected calendar account matches "${request.account}".`
          : 'Connect Google Calendar in Settings → Connections.',
      ]
      return result
    }
    let event: CalendarEventSnapshot
    if (request.event) {
      if (!matches.includes(request.event.account))
        throw new Error('Choose an event from a connected, matching account.')
      event = await this.provider.read(request.event)
    } else {
      const search = await this.provider.locate(request.request, timezone, signal)
      const from = new PlainDate(search.from)
      const to = new PlainDate(search.to)
      if (to.ymd <= from.ymd || to.ymd > from.addDays(93).ymd)
        throw new Error('Use an event search window of at most 93 days.')
      const found = await this.provider.find({ ...search, timezone }, matches)
      result.candidates = found.events
      result.warnings = found.warnings
      if (found.events.length !== 1 || found.warnings.length) {
        result.questions = [
          found.events.length
            ? 'Which existing calendar event should be updated?'
            : 'No matching event was found. Specify its current title, guest, or date.',
        ]
        if (!found.events.length) result.requestQuestions = [...result.questions]
        return result
      }
      // Read the exact identity again: search results are for selection, not a write snapshot.
      event = await this.provider.read(found.events[0]!.ref)
    }
    result.event = event
    result.candidates = [event]
    result.fields = structuredClone(event.fields)
    if (event.unsupported.length) {
      result.status = 'unsupported'
      result.unsupported = event.unsupported
      return result
    }
    requireEditable(event)
    const parsed = await this.provider.parse(request.request, event, request.timezone ?? event.fields.timezone, signal)
    const checked = eventFieldsSchema.omit({ account: true, guests: true }).partial().safeParse(parsed.changes)
    const changes = checked.success ? checked.data : parsed.changes
    Object.assign(result, {
      addGuests: parsed.addGuests,
      removeGuests: parsed.removeGuests,
      assumptions: parsed.assumptions,
      questions: [...parsed.questions],
      requestQuestions: [...parsed.questions],
      unsupported: parsed.unsupported,
    })
    if (!checked.success) {
      const question = 'Check the updated date, time, duration, title, agenda or location.'
      result.questions.push(question)
      result.requestQuestions.push(question)
    }
    const removed = new Set(
      parsed.removeGuests.flatMap((guest) => (guest.selected ? [guest.selected.email.toLowerCase()] : [])),
    )
    result.fields = {
      ...event.fields,
      ...changes,
      guests: [
        ...event.fields.guests.filter((guest) => !removed.has(guest.email.toLowerCase())),
        ...parsed.addGuests.flatMap((guest) => (guest.selected ? [guest.selected] : [])),
      ],
    }
    for (const [action, guests] of [
      ['add', parsed.addGuests],
      ['remove', parsed.removeGuests],
    ] as const) {
      for (const guest of guests) {
        if (!guest.selected) {
          const question =
            action === 'remove' && !guest.candidates.length
              ? `No current guest matches "${guest.query}". Specify their current name or email address.`
              : `Which guest should be ${action === 'add' ? 'added' : 'removed'} for "${guest.query}"?`
          result.questions.push(question)
          if (action === 'remove' && !guest.candidates.length) result.requestQuestions.push(question)
        }
      }
    }
    if (result.unsupported.length) result.status = 'unsupported'
    if (result.unsupported.length || result.questions.length) return result
    try {
      return await this.finish(result)
    } catch (error) {
      const question = error instanceof Error ? error.message : 'Check the event changes.'
      result.questions.push(question)
      result.requestQuestions.push(question)
      return result
    }
  }

  async review(input: unknown): Promise<CalendarUpdatePreparation> {
    const reviewed = z
      .object({
        event: eventRefSchema,
        version: z.string().min(1).max(2000),
        fields: z.unknown(),
        assumptions: z.array(z.string().max(1000)).max(50).default([]),
      })
      .strict()
      .parse(input)
    const setup = await this.host.setup()
    if (!setup.accounts.map((account) => account.toLowerCase()).includes(reviewed.event.account))
      throw new Error('Choose a connected Google account.')
    const event = await this.provider.read(reviewed.event)
    if (event.version !== reviewed.version)
      throw new Error('This event changed. Prepare the update again before saving.')
    return this.finish({
      ...empty(),
      event,
      candidates: [event],
      fields: validateEventUpdate(event, reviewed.fields, this.now()),
      assumptions: reviewed.assumptions,
    })
  }

  private async finish(result: CalendarUpdatePreparation): Promise<CalendarUpdatePreparation> {
    const event = result.event!
    const fields = validateEventUpdate(event, result.fields, this.now())
    const availability = await this.host.availability(fields, event)
    const draftId = await this.drafts.save({ fields, reviewKey: availability.reviewKey, update: event })
    return { ...result, status: 'ready', fields, availability, draftId }
  }
}
