import type { CalendarDraft, CalendarFields, CalendarInvitee } from '#lib/calendarScheduler/types.ts'

const editableFields = ['title', 'date', 'time', 'timezone', 'duration', 'description'] as const
const normalized = (value: string) => value.trim().toLowerCase()

function sameInvitee(a: CalendarInvitee, b: CalendarInvitee): boolean {
  if (normalized(a.query) === normalized(b.query)) return true
  return (
    !a.query.includes('@') &&
    !b.query.includes('@') &&
    a.candidates.length === 1 &&
    b.candidates.length === 1 &&
    a.candidates[0]!.id === b.candidates[0]!.id
  )
}

/** Merge new wording with the reviewed draft, using the previous AI result to recognize manual edits. */
export function mergeMeetingDraft(
  current: CalendarDraft | null,
  previous: CalendarDraft | null,
  next: CalendarDraft,
  editedDuringRequest: ReadonlySet<keyof CalendarFields> = new Set(),
): CalendarDraft {
  if (!current) return next
  let fields = { ...next.fields, account: current.fields.account || next.fields.account }
  for (const key of editableFields) {
    if (editedDuringRequest.has(key) || (previous && next.fields[key] === previous.fields[key]))
      fields = { ...fields, [key]: current.fields[key] }
  }
  const invitees = next.invitees.flatMap((invitee) => {
    const before = previous?.invitees.find((item) => sameInvitee(item, invitee))
    const reviewed = current.invitees.find((item) => sameInvitee(item, invitee))
    // Removing a suggested guest is also an edit; typing the time must not add them back.
    if (before && !reviewed) return []
    if (!reviewed) return [invitee]
    const selectedChanged =
      !before ||
      reviewed.personId !== before.personId ||
      reviewed.selected?.email !== before.selected?.email ||
      reviewed.selected?.name !== before.selected?.name
    if (!selectedChanged) return [invitee]
    const chosen = reviewed.candidates.find((person) => person.id === reviewed.personId)
    const candidates =
      chosen && !invitee.candidates.some((person) => person.id === chosen.id)
        ? [...invitee.candidates, chosen]
        : invitee.candidates
    return [{ ...invitee, candidates, selected: reviewed.selected, personId: reviewed.personId }]
  })
  for (const invitee of current.invitees) {
    if (
      !previous?.invitees.some((item) => sameInvitee(item, invitee)) &&
      !next.invitees.some((item) => sameInvitee(item, invitee))
    )
      invitees.push(invitee)
  }
  const keptFieldEdits = editableFields.some((key) => fields[key] !== next.fields[key])
  return {
    ...next,
    fields,
    invitees,
    assumptions: keptFieldEdits ? [] : next.assumptions,
    questions: keptFieldEdits ? [] : next.questions,
  }
}
