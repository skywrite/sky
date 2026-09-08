import { z } from 'zod'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import type { Prompter } from '#commands/lib/prompt/Prompter.ts'
import type { CalendarSchedulerClient } from '#lib/calendarScheduler/client.ts'
import type {
  CalendarContact,
  CalendarGuest,
  CalendarInvitee,
  CalendarPreparation,
  CalendarRequest,
} from '#lib/calendarScheduler/types.ts'

export interface Interaction {
  prompt: Prompter
  output: OutputHandler
  signal?: AbortSignal
}

async function emailFor(name: string, account: string, interaction: Interaction): Promise<string | null> {
  for (;;) {
    const email = await interaction.prompt.text({ message: `Email address for ${name}` })
    if (email === null || !email.trim()) return null
    const normalized = email.trim().toLowerCase()
    if (!z.email().safeParse(normalized).success) {
      interaction.output.log('Enter a valid email address.')
    } else if (normalized === account.toLowerCase()) {
      interaction.output.log('That is the organizer address. Choose a different guest address.')
    } else return normalized
  }
}

export async function pickGuest(
  invitee: CalendarInvitee,
  account: string,
  interaction: Interaction,
): Promise<CalendarGuest | null> {
  const { prompt } = interaction
  const selected = invitee.selected
  if (selected && z.email().safeParse(selected.email).success && selected.email.toLowerCase() !== account.toLowerCase())
    return selected

  let person: CalendarContact | undefined
  if (invitee.candidates.length === 1) person = invitee.candidates[0]
  else if (invitee.candidates.length > 1) {
    const choice = await prompt.select({
      message: `Who do you mean by "${invitee.query}"?`,
      options: [
        ...invitee.candidates.map((candidate, index) => ({
          value: String(index),
          label: candidate.name,
          hint: candidate.hint,
        })),
        { value: 'email', label: 'Enter an email address' },
      ],
    })
    if (choice === null) return null
    person = choice === 'email' ? undefined : invitee.candidates[Number(choice)]
  }
  const name = person?.name ?? invitee.query
  const emails = [...new Set(person?.emails ?? [])].filter(
    (email) => z.email().safeParse(email).success && email.toLowerCase() !== account.toLowerCase(),
  )
  if (emails.length === 1) return { name, email: emails[0]! }
  if (emails.length > 1) {
    const email = await prompt.select({
      message: `Which email address for ${name}?`,
      options: [
        ...emails.map((email) => ({ value: email, label: email })),
        { value: 'email', label: 'Enter another email address' },
      ],
    })
    if (email === null) return null
    if (email !== 'email') return { name, email }
  }
  const email = await emailFor(name, account, interaction)
  return email ? { name, email } : null
}

/** Ask through the existing terminal prompt seam; exact selections bypass AI interpretation. */
export async function promptSchedule(
  client: Pick<CalendarSchedulerClient, 'prepare' | 'review'>,
  request: CalendarRequest,
  prepared: CalendarPreparation,
  interaction: Interaction,
): Promise<CalendarPreparation | null> {
  const { prompt, output, signal } = interaction
  let current = request
  while (prepared.unsupported.length || prepared.requestQuestions?.length) {
    signal?.throwIfAborted()
    const unsupported = prepared.unsupported.length > 0
    const questions = unsupported ? prepared.unsupported : (prepared.requestQuestions ?? [])
    const answer = await prompt.text({
      message: unsupported ? 'How would you like to revise the meeting request?' : 'Please clarify the meeting details',
      hint: questions,
    })
    if (answer === null || !answer.trim()) return null
    current = { ...current, request: unsupported ? answer : `${current.request}\nClarification: ${answer}` }
    prepared = await client.prepare(current, signal)
  }
  if (prepared.status === 'ready') return prepared
  if (!prepared.accounts.length) {
    output.log('Connect a Google Calendar account in Settings → Connections, then retry.')
    return prepared
  }

  const fields = structuredClone(prepared.fields)
  if (!fields.account) {
    const account = await prompt.select({
      message: 'Which account should organize the meeting?',
      options: prepared.accounts.map((account) => ({ value: account, label: account })),
    })
    if (account === null) return null
    fields.account = account
  }
  fields.guests = []
  for (const invitee of prepared.invitees) {
    signal?.throwIfAborted()
    const guest = await pickGuest(invitee, fields.account, interaction)
    if (!guest) return null
    fields.guests.push(guest)
  }
  return client.review({ fields, assumptions: prepared.assumptions }, signal)
}
