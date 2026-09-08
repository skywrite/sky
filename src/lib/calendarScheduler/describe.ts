import type { CalendarJob, CalendarPreparation } from './types.ts'
import type { CalendarUpdatePreparation } from './updateTypes.ts'

export function describePreparation(prepared: CalendarPreparation): string {
  const { fields, availability } = prepared
  const lines = [
    fields.title || 'Calendar invitation',
    `${fields.date || '(date needed)'} ${fields.time || '(time needed)'} · ${fields.timezone} · ${fields.duration} min`,
    `Organizer: ${fields.account || '(choose an account)'}`,
    ...fields.guests.map((guest) => `Invite: ${guest.name ? `${guest.name} <${guest.email}>` : guest.email}`),
    ...(fields.description ? [`Agenda: ${fields.description}`] : []),
    ...prepared.assumptions.map((assumption) => `Assumption: ${assumption}`),
  ]
  for (const invitee of prepared.invitees.filter((invitee) => !invitee.selected)) {
    lines.push(`Unresolved guest: ${invitee.query}`)
    for (const candidate of invitee.candidates)
      lines.push(`  ${candidate.name} · ${candidate.hint} · ${candidate.emails.join(', ') || 'no saved email'}`)
  }
  if (!fields.account && prepared.accounts.length) lines.push(`Accounts: ${prepared.accounts.join(', ')}`)
  if (availability) {
    const conflicts = availability.events.filter((event) => event.conflict)
    lines.push(
      ...conflicts.map((event) => `Conflict: ${event.title} · ${event.start} – ${event.end} · ${event.calendar}`),
      ...availability.warnings.map((warning) => `Calendar check incomplete: ${warning}`),
    )
    if (!conflicts.length && !availability.warnings.length) lines.push('No conflicts on your checked calendars.')
    if (availability.alternatives.length) lines.push(`Nearby free times: ${availability.alternatives.join(', ')}`)
  }
  lines.push(...prepared.questions.map((question) => `Question: ${question}`))
  lines.push(...prepared.unsupported.map((item) => `Unsupported: ${item}`))
  if (prepared.draftId) lines.push(`Prepared. To create and send: sky calendar:schedule --send ${prepared.draftId}`)
  return lines.join('\n')
}

export function describeCalendarJob(job: CalendarJob): string {
  if ((job.state === 'created' || job.state === 'updated') && job.result)
    return [
      `${job.state === 'updated' ? 'Updated' : 'Created'}: ${job.result.title}`,
      `Calendar: ${job.result.calendarUrl}`,
      ...(job.result.zoomUrl
        ? [`Zoom: ${job.result.zoomUrl}`]
        : job.result.conferenceUrl
          ? [`Conference: ${job.result.conferenceUrl}`]
          : []),
    ].join('\n')
  if (job.state === 'creating' || job.state === 'updating')
    return `Still ${job.state}. Retrieve the same request with: sky calendar:${job.operation === 'update' ? 'update' : 'schedule'} --send ${job.id}`
  return `${job.state === 'uncertain' ? 'Save unconfirmed' : job.operation === 'update' ? 'Update failed' : 'Creation failed'}: ${job.message ?? 'Check Google Calendar.'}`
}

export function describeUpdatePreparation(prepared: CalendarUpdatePreparation): string {
  const { event, fields, availability } = prepared
  const lines: string[] = []
  if (event && fields) {
    lines.push(`Update: ${event.fields.title}`, `Calendar: ${event.calendarName} · ${event.ref.account}`)
    if (event.recurring) lines.push('Scope: this occurrence only.')
    const when = (value: typeof fields) => `${value.date} ${value.time} · ${value.timezone} · ${value.duration} min`
    lines.push(`Before: ${when(event.fields)}`, `After:  ${when(fields)}`)
    for (const [key, label] of [
      ['title', 'Title'],
      ['description', 'Agenda'],
      ['location', 'Location'],
    ] as const)
      if (event.fields[key] !== fields[key])
        lines.push(`${label}: ${event.fields[key] || '(empty)'} → ${fields[key] || '(empty)'}`)
    const before = new Set(event.fields.guests.map((guest) => guest.email))
    const after = new Set(fields.guests.map((guest) => guest.email))
    for (const guest of event.fields.guests) if (!after.has(guest.email)) lines.push(`Remove guest: ${guest.email}`)
    for (const guest of fields.guests)
      if (!before.has(guest.email)) lines.push(`Add guest: ${guest.name} <${guest.email}>`)
    if (event.conferenceUrl) lines.push(`Conference: ${event.conferenceUrl}`)
  } else {
    for (const candidate of prepared.candidates)
      lines.push(
        `${candidate.fields.title} · ${candidate.fields.date} ${candidate.fields.time} ${candidate.fields.timezone} · ${candidate.ref.account}`,
      )
  }
  lines.push(
    ...prepared.assumptions.map((value) => `Assumption: ${value}`),
    ...prepared.warnings.map((value) => `Search incomplete: ${value}`),
  )
  for (const [action, guests] of [
    ['add', prepared.addGuests],
    ['remove', prepared.removeGuests],
  ] as const)
    for (const guest of guests.filter((item) => !item.selected))
      lines.push(`Unresolved guest to ${action}: ${guest.query}`)
  if (availability) {
    const conflicts = availability.events.filter((value) => value.conflict)
    lines.push(
      ...conflicts.map((value) => `Conflict: ${value.title} · ${value.start} – ${value.end} · ${value.calendar}`),
      ...availability.warnings.map((value) => `Calendar check incomplete: ${value}`),
    )
    if (!conflicts.length && !availability.warnings.length) lines.push('No conflicts on your checked calendars.')
    if (availability.alternatives.length) lines.push(`Nearby free times: ${availability.alternatives.join(', ')}`)
  }
  lines.push(
    ...prepared.questions.map((value) => `Question: ${value}`),
    ...prepared.unsupported.map((value) => `Unsupported: ${value}`),
  )
  if (prepared.draftId)
    lines.push(`Prepared. To save and notify guests: sky calendar:update --send ${prepared.draftId}`)
  return lines.join('\n')
}
