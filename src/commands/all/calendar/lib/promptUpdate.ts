import type { CalendarSchedulerClient } from '#lib/calendarScheduler/client.ts'
import type { CalendarUpdatePreparation, CalendarUpdateRequest } from '#lib/calendarScheduler/updateTypes.ts'
import { pickGuest, type Interaction } from './promptSchedule.ts'

export async function promptUpdate(
  client: Pick<CalendarSchedulerClient, 'prepareUpdate' | 'reviewUpdate'>,
  request: CalendarUpdateRequest,
  prepared: CalendarUpdatePreparation,
  interaction: Interaction,
): Promise<CalendarUpdatePreparation | null> {
  const { prompt, output, signal } = interaction
  let current = request
  while (!prepared.event || prepared.requestQuestions.length) {
    signal?.throwIfAborted()
    if (!prepared.event && prepared.candidates.length) {
      for (const warning of prepared.warnings) output.log(`Search incomplete: ${warning}`)
      const selected = await prompt.select({
        message: 'Which event should be updated?',
        options: prepared.candidates.map((event, index) => ({
          value: String(index),
          label: event.fields.title,
          hint: `${event.fields.date} ${event.fields.time} ${event.fields.timezone} · ${event.calendarName} · ${event.ref.account}`,
        })),
      })
      if (selected === null) return null
      const event = prepared.candidates[Number(selected)]
      if (!event) throw new Error('Choose one of the listed events.')
      current = { ...current, event: event.ref }
    } else {
      if (!prepared.requestQuestions.length) return prepared
      const answer = await prompt.text({ message: 'Please clarify the event update', hint: prepared.requestQuestions })
      if (answer === null || !answer.trim()) return null
      current = {
        ...current,
        event: prepared.event?.ref ?? current.event,
        request: `${current.request}\nClarification: ${answer}`,
      }
    }
    prepared = await client.prepareUpdate(current, signal)
  }
  if (prepared.status === 'ready' || prepared.status === 'unsupported') return prepared
  const fields = structuredClone(prepared.fields!)
  for (const guest of prepared.removeGuests.filter((item) => !item.selected)) {
    const choices = guest.candidates.flatMap((person) =>
      person.emails.map((email) => ({ value: email, label: person.name, hint: email })),
    )
    if (!choices.length) {
      output.log(`No current guest matches "${guest.query}". Specify the guest's current email address.`)
      return prepared
    }
    const email = await prompt.select({
      message: `Which current guest should be removed for "${guest.query}"?`,
      options: choices,
    })
    if (email === null) return null
    fields.guests = fields.guests.filter((item) => item.email.toLowerCase() !== email.toLowerCase())
  }
  for (const guest of prepared.addGuests.filter((item) => !item.selected)) {
    const selected = await pickGuest(guest, fields.account, interaction)
    if (!selected) return null
    fields.guests.push(selected)
  }
  return client.reviewUpdate(
    { event: prepared.event!.ref, version: prepared.event!.version, fields, assumptions: prepared.assumptions },
    signal,
  )
}
