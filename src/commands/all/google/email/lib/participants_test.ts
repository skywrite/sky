import { createAttendeeNames } from '#service/handler/day/attendeeNames.ts'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { assert, test } from '#test'
import { messageParticipants } from './participants.ts'

async function peopleOf(...profiles: Record<string, unknown>[]): Promise<PeopleStore> {
  const people = await PeopleStore.build([])
  profiles.forEach((profile, index) => {
    people.set(`/notebook/people/Contact-${index}.md`, `---\n${JSON.stringify(profile)}\n---\n`)
  })
  return people
}

const PROFILES = [
  { name: ['Jane Doe', 'Jane'], email: { personal: 'jane@example.com' } },
  { name: ['Sam Rivera'], email: 'sam@example.com' },
  { name: ['Sam Lee'], email: 'sam.lee@example.com' },
  { name: ['Alex Chen'], email: 'alex@example.com' },
  { name: ['Riley Brooks'], email: { business: ['riley@atlas.example.com'] } },
  { name: ['Taylor Morgan'], email: 'support@example.com' },
  { name: ['Morgan Lee'], email: 'support@example.com' },
]

const FAMILIAR = [
  { name: 'Jane Doe', familiarityScore: 150 },
  { name: 'Sam Lee', familiarityScore: 150 },
]

test('messageParticipants names every address a profile lists', async () => {
  const names = createAttendeeNames(await peopleOf(...PROFILES), FAMILIAR)

  assert({
    given: 'bare addresses across to, cc and bcc: a familiar profile, an unfamiliar one, and strangers',
    should: 'write the short name, the full name, and leave the strangers as the mail gave them',
    expected: {
      from: 'Alex Chen',
      to: 'Jane, Sam Rivera, unknown@example.com',
      cc: 'John Doe',
      bcc: 'Riley Brooks',
    },
    actual: messageParticipants(
      {
        from: { address: 'alex@example.com' },
        to: [{ address: 'jane@example.com' }, { address: 'SAM@example.com' }, { address: 'unknown@example.com' }],
        cc: [{ name: 'Doe, John', address: 'john@example.com' }],
        bcc: [{ address: 'riley@atlas.example.com' }],
      },
      names,
    ),
  })

  assert({
    given: 'display names that are the address itself, or differ from the profile',
    should: 'write the profile name, so a person reads the same on every capture',
    expected: { from: 'Jane', to: 'Alex Chen', cc: '', bcc: '' },
    actual: messageParticipants(
      {
        from: { name: 'jane@example.com', address: 'jane@example.com' },
        to: [{ name: 'A. Chen', address: 'alex@example.com' }],
      },
      names,
    ),
  })

  assert({
    given: 'an address two profiles list',
    should: 'name neither profile and keep what the mail gave',
    expected: 'Support team, support@example.com',
    actual: messageParticipants(
      { to: [{ name: 'Support team', address: 'support@example.com' }, { address: 'support@example.com' }] },
      names,
    ).to,
  })
})

test('messageParticipants keeps namesakes on one message apart', async () => {
  const names = createAttendeeNames(await peopleOf(...PROFILES), [
    ...FAMILIAR,
    { name: 'Sam Rivera', familiarityScore: 150 },
  ])

  assert({
    given: 'two familiar people sharing a short name, one in to and one in cc',
    should: 'write both full names',
    expected: { to: 'Sam Rivera', cc: 'Sam Lee' },
    actual: (({ to, cc }) => ({ to, cc }))(
      messageParticipants(
        {
          from: { address: 'jane@example.com' },
          to: [{ address: 'sam@example.com' }],
          cc: [{ address: 'sam.lee@example.com' }],
        },
        names,
      ),
    ),
  })
})

test('messageParticipants marks a missing sender', async () => {
  const names = createAttendeeNames(await peopleOf(...PROFILES), FAMILIAR)

  assert({
    given: 'a message with no From header and no other recipients',
    should: 'mark the sender unknown and leave the other fields empty',
    expected: { from: '(unknown)', to: '', cc: '', bcc: '' },
    actual: messageParticipants({}, names),
  })
})
