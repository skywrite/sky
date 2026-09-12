import { z } from 'zod'
import { calendarInstant, calendarNow, instantNow } from '#universal/dates/nbdt/mod.ts'
import { calendarBatch, calendarDraftIdsSchema } from './batch.ts'
import { describePreparation, describeUpdatePreparation } from './describe.ts'
import { CalendarDrafts } from './drafts.ts'
import { CalendarJobs } from './jobs.ts'
import { inviteeQuestion } from './people.ts'
import type {
  CalendarApproval,
  CalendarJobBatch,
  CalendarPreparation,
  CalendarRequest,
  CalendarSchedulerHost,
} from './types.ts'
import { CalendarUpdates } from './updates.ts'
import type { CalendarUpdateRequest } from './updateTypes.ts'
import { eventFieldsSchema, validateEventUpdate } from './updateValidation.ts'
import { meetingFieldsSchema, meetingInterval, meetingTimingSchema, validateMeeting } from './validation.ts'

const requestSchema = z.object({
  request: z.string().trim().min(1).max(4000),
  account: z.string().trim().min(1).max(254).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
})

const createSchema = z.object({
  id: z.uuid(),
  fields: z.unknown(),
  reviewKey: z.string().regex(/^[a-f0-9]{64}$/),
})

/** One scheduling workflow for the composer, commands, chat and voice. */
export class CalendarScheduler {
  private readonly drafts: CalendarDrafts
  private readonly jobs: CalendarJobs
  private readonly updates: CalendarUpdates

  constructor(
    private readonly host: CalendarSchedulerHost,
    private readonly options: { hold?: () => () => void; now?: () => string } = {},
  ) {
    this.drafts = new CalendarDrafts(host.dir)
    this.jobs = new CalendarJobs(host, options.hold)
    this.updates = new CalendarUpdates(host, this.drafts, options.now)
  }

  setup() {
    return this.host.setup()
  }

  people(query: string) {
    return this.host.people(query.slice(0, 200))
  }

  async parse(input: unknown, signal?: AbortSignal) {
    const { query, timezone } = z
      .object({ query: z.string().trim().min(1).max(4000), timezone: z.string().min(1).max(100) })
      .parse(input)
    return this.host.parse(query, timezone, signal)
  }

  async preview(input: unknown) {
    const timing = meetingTimingSchema.parse(input)
    meetingInterval(timing)
    return this.host.availability(timing)
  }

  private requireFuture(fields: Parameters<typeof meetingInterval>[0]): void {
    if (meetingInterval(fields).startMilliseconds <= calendarInstant((this.options.now ?? instantNow)()))
      throw new Error('Choose a future meeting time.')
  }

  async create(input: unknown) {
    const { id, fields: value, reviewKey } = createSchema.parse(input)
    const fields = validateMeeting(value)
    // Existing IDs retrieve their original outcome, even after the meeting time has passed.
    if (!(await this.jobs.get(id))) {
      this.requireFuture(fields)
      const setup = await this.host.setup()
      if (!setup.accounts.includes(fields.account)) throw new Error('Choose a connected Google account.')
    }
    return this.jobs.start(id, fields, reviewKey)
  }

  get(id: string) {
    return this.jobs.get(id)
  }

  /** Approval describes persisted fields, never a model-supplied summary or just an ID. */
  async approval(id: string, operation: 'schedule' | 'update'): Promise<CalendarApproval> {
    const draft = await this.drafts.get(id)
    if (Boolean(draft.update) !== (operation === 'update'))
      throw new Error(`Use calendar:${draft.update ? 'update' : 'schedule'} for this draft.`)
    let summary = draft.summary
    if (!summary) {
      // Drafts prepared before conversational tools existed have no saved presentation.
      const availability = await this.host.availability(draft.fields, draft.update)
      if (availability.reviewKey !== draft.reviewKey)
        throw new Error('Calendar availability changed. Review the event again before saving.')
      const common = {
        status: 'ready' as const,
        availability,
        assumptions: [],
        questions: [],
        requestQuestions: [],
        unsupported: [],
      }
      summary = draft.update
        ? describeUpdatePreparation({
            ...common,
            fields: eventFieldsSchema.parse(draft.fields),
            event: draft.update,
            candidates: [],
            addGuests: [],
            removeGuests: [],
            warnings: [],
          })
        : describePreparation({ ...common, fields: draft.fields, invitees: [], accounts: [draft.fields.account] })
    }
    const affectsGuests = [draft.fields, ...(draft.update ? [draft.update.fields] : [])].some((fields) =>
      fields.guests.some((guest) => guest.email.toLowerCase() !== fields.account.toLowerCase()),
    )
    const action = draft.update ? 'Save these event changes' : 'Create this event'
    const delivery = affectsGuests
      ? draft.update
        ? ' and notify guests.'
        : ' and send invitations.'
      : ' on your calendar.'
    return { summary: `${action}${delivery}\n${summary}`, needsApproval: affectsGuests && !(await this.jobs.get(id)) }
  }

  async prepare(input: CalendarRequest, signal?: AbortSignal): Promise<CalendarPreparation> {
    const request = requestSchema.parse(input)
    const setup = await this.host.setup()
    const timezone = request.timezone ?? setup.timezone
    calendarNow(timezone)
    const parsed = await this.host.parse(request.request, timezone, signal)
    const requestedAccount = request.account?.toLowerCase()
    const accounts = setup.accounts.map((account) => account.toLowerCase())
    const exact = accounts.find((account) => account === requestedAccount)
    const matches = exact
      ? [exact]
      : accounts.filter((account) => !requestedAccount || account.includes(requestedAccount))
    const account = matches.length === 1 ? matches[0]! : ''
    const fields = {
      ...parsed.fields,
      account,
      guests: parsed.invitees.flatMap((invitee) => (invitee.selected ? [invitee.selected] : [])),
    }
    const questions = [...parsed.questions]
    const requestQuestions = [...parsed.questions]
    const askAboutRequest = (question: string) => {
      questions.push(question)
      requestQuestions.push(question)
    }
    if (!account) {
      questions.push(
        !accounts.length
          ? 'Connect a Google Calendar account in Settings → Connections.'
          : requestedAccount && !matches.length
            ? `No connected account matches "${request.account}". Choose one with --account.`
            : 'Which Google account should organize the meeting? Choose one with --account.',
      )
    }
    for (const invitee of parsed.invitees) {
      if (!invitee.selected) questions.push(inviteeQuestion(invitee))
    }
    const checked = meetingFieldsSchema.safeParse(fields)
    if (!checked.success) {
      const labels: Record<string, string> = {
        title: 'Give the meeting a title.',
        date: 'Specify a valid calendar date.',
        time: 'Specify an unambiguous time.',
        timezone: 'Specify a valid timezone.',
        duration: 'Use a duration of 5–720 whole minutes.',
        description: 'Keep the agenda under 8,000 characters.',
        guests: 'Use at most 50 guests with valid email addresses, or leave the guest list empty.',
        conference: 'Choose Zoom or no video conferencing.',
        account: 'Choose a connected Google account.',
      }
      for (const issue of checked.error.issues) {
        const field = String(issue.path[0])
        if ((field === 'account' && !account) || (field === 'guests' && !fields.guests.length)) continue
        const question = labels[field] ?? 'Check the meeting details.'
        if (field === 'account' || field === 'guests') questions.push(question)
        else askAboutRequest(question)
      }
    }
    let availability: CalendarPreparation['availability']
    if (meetingTimingSchema.safeParse(fields).success) {
      try {
        this.requireFuture(fields)
        availability = await this.host.availability(fields)
      } catch (error) {
        askAboutRequest(error instanceof Error ? error.message : 'Could not check the requested time.')
      }
    }
    if (checked.success) {
      try {
        Object.assign(fields, validateMeeting(fields))
      } catch (error) {
        questions.push(error instanceof Error ? error.message : 'Check the meeting details.')
      }
    }
    const status = parsed.unsupported.length ? 'unsupported' : questions.length ? 'needs_input' : 'ready'
    const result: CalendarPreparation = {
      ...parsed,
      fields,
      questions: [...new Set(questions)],
      requestQuestions: [...new Set(requestQuestions)],
      status,
      accounts,
      availability,
    }
    if (status === 'ready' && availability) {
      result.draftId = await this.drafts.save({
        fields,
        reviewKey: availability.reviewKey,
        summary: describePreparation(result),
      })
    }
    return result
  }

  /** Persist explicit choices without interpreting the original request again. */
  async review(input: unknown): Promise<CalendarPreparation> {
    const reviewed = z
      .object({
        fields: z.unknown(),
        assumptions: z.array(z.string().max(1000)).max(50).default([]),
      })
      .strict()
      .parse(input)
    const fields = validateMeeting(reviewed.fields)
    this.requireFuture(fields)
    const setup = await this.host.setup()
    if (!setup.accounts.includes(fields.account)) throw new Error('Choose a connected Google account.')
    const availability = await this.host.availability(fields)
    const result: CalendarPreparation = {
      status: 'ready',
      fields,
      accounts: setup.accounts,
      availability,
      invitees: fields.guests.map((guest) => ({ query: guest.name || guest.email, candidates: [], selected: guest })),
      assumptions: reviewed.assumptions,
      questions: [],
      requestQuestions: [],
      unsupported: [],
    }
    result.draftId = await this.drafts.save({
      fields,
      reviewKey: availability.reviewKey,
      summary: describePreparation(result),
    })
    return result
  }

  async send(id: string) {
    const draft = await this.drafts.get(id)
    if (draft.update) return this.update(id)
    return this.create({ id, ...draft })
  }

  /** Check every draft before starting any writes; each event retains its own durable receipt. */
  async sendBatch(input: unknown): Promise<CalendarJobBatch> {
    const ids = calendarDraftIdsSchema.parse(input)
    const drafts = await Promise.all(ids.map((id) => this.drafts.get(id)))
    const previous = await Promise.all(ids.map((id) => this.jobs.get(id)))
    const setup = await this.host.setup()
    const fields = drafts.map((draft, index) => {
      if (draft.update) throw new Error('Use calendar:update for event update drafts.')
      const fields = validateMeeting(draft.fields)
      if (!previous[index]) {
        this.requireFuture(fields)
        if (!setup.accounts.includes(fields.account)) throw new Error('Choose a connected Google account.')
      }
      return fields
    })
    const jobs: CalendarJobBatch['jobs'] = []
    for (const [index, id] of ids.entries()) {
      try {
        jobs.push(await this.jobs.start(id, fields[index]!, drafts[index]!.reviewKey))
      } catch (error) {
        jobs.push({
          id,
          state: 'uncertain',
          message:
            error instanceof Error
              ? error.message
              : 'Could not confirm this calendar request. Check its status before retrying.',
        })
      }
    }
    return calendarBatch(jobs)
  }

  prepareUpdate(input: CalendarUpdateRequest, signal?: AbortSignal) {
    return this.updates.prepare(input, signal)
  }

  reviewUpdate(input: unknown) {
    return this.updates.review(input)
  }

  async update(id: string) {
    const draft = await this.drafts.get(id)
    if (!draft.update) throw new Error('Prepare an event update with calendar:update first.')
    const previous = await this.jobs.get(id)
    if (previous) return previous
    const fields = validateEventUpdate(draft.update, draft.fields, (this.options.now ?? instantNow)())
    const setup = await this.host.setup()
    if (!setup.accounts.includes(fields.account)) throw new Error('Choose a connected Google account.')
    return this.jobs.start(id, fields, draft.reviewKey, draft.update)
  }
}
