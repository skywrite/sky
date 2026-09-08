import { inviteeQuestion, meetingPeople, resolveInvitee } from '#lib/calendarScheduler/people.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { INTERACTION_WEIGHTS, Store } from '../../store.ts'

test('meeting people use the IntelliSense interaction scores, combining aliases once per contact', async () => {
  const notebook = await MarkdownStore.build({ peopleDirs: [], orgDirs: [] })
  const scores = new Store()
  const today = new PlainDate('2030-05-01')
  const profiles = [
    { name: 'Sam Adams', names: ['Sam Adams', 'S Adams'], emails: ['sam.adams@example.com'] },
    { name: 'Sam Rivera', names: ['Sam Rivera', 'Samuel Rivera'], emails: ['sam@example.com', 'sam.work@example.com'] },
    { name: 'Sam Young', names: ['Sam Young'], emails: ['sam.young@example.com'] },
  ]
  for (const person of profiles) {
    const file = `/notebook/people/${person.name.replaceAll(' ', '-')}.md`
    notebook.people.set(
      file,
      `---\nname: ${JSON.stringify(person.names)}\nemail: ${JSON.stringify(person.emails)}\n---\n`,
    )
    scores.rememberPersonNames(file, person.names)
  }
  scores.update('people', new Set(profiles.flatMap((person) => person.names)))
  scores.recordInteraction('Sam Adams', today.ymd, INTERACTION_WEIGHTS.email, today)
  scores.recordInteraction('Sam Rivera', today.ymd, INTERACTION_WEIGHTS.meeting, today)
  scores.recordInteraction('Samuel Rivera', today.ymd, INTERACTION_WEIGHTS.meeting, today)
  scores.recordInteraction('Sam Young', today.ymd, INTERACTION_WEIGHTS.meeting, today)
  scores.recordInteraction('Sam Young', today.ymd, INTERACTION_WEIGHTS.email, today)
  const people = (query: string) => meetingPeople(notebook, query, scores.getPeopleWithScores())
  assert({
    given: 'more interactions with one namesake, including under their alias',
    should: 'rank by the shared score instead of alphabetical order and show one contact with all their emails',
    actual: people('Sam').map(({ name, emails }) => ({ name, emails })),
    expected: [profiles[1], profiles[2], profiles[0]].map(({ name, emails }) => ({ name, emails })),
  })
  assert({
    given: 'an exact full name or an explicit email for a less frequent contact',
    should: 'honor the explicit identity instead of substituting a higher-scored person',
    actual: [people('Sam Adams')[0]?.name, people('sam.adams@example.com')[0]?.name],
    expected: ['Sam Adams', 'Sam Adams'],
  })
  scores.recordInteraction('Sam Young', today.ymd, INTERACTION_WEIGHTS.meeting, today)
  assert({
    given: 'new interactions after the first suggestions were requested',
    should: 'refresh the ordering without multiplying scores for profiles with several aliases',
    actual: people('Sam').map((person) => person.name),
    expected: ['Sam Young', 'Sam Rivera', 'Sam Adams'],
  })
})

test('calendar names and initials keep a matched identity and ask only for its unresolved email', async () => {
  const notebook = await MarkdownStore.build({ peopleDirs: [], orgDirs: [] })
  notebook.people.set(
    '/notebook/people/Jordan-Davis.md',
    '---\nname: [Jordan Davis, JD]\nemail: [jordan@example.com, jordan.work@example.com]\n---\n',
  )
  notebook.people.set(
    '/notebook/people/Jane-Dawson.md',
    '---\nname: Jane Dawson\nemail: jane.dawson@example.com\n---\n',
  )
  const scores = [
    { name: 'Jordan Davis', score: 20 },
    { name: 'Jane Dawson', score: 200 },
  ]
  const matches = meetingPeople(notebook, 'JD', scores)
  const invitee = resolveInvitee('JD', matches)
  assert({
    given: 'an exact stored alias, multiple saved emails, and a more frequent fuzzy match',
    should: 'retain the identified profile and offer its saved addresses without asking who it is',
    actual: [
      matches[0]?.name,
      matches[0]?.aliases,
      matches[0]?.interactionScore,
      invitee.personId,
      invitee.selected,
      inviteeQuestion(invitee),
    ],
    expected: [
      'Jordan Davis',
      ['JD'],
      20,
      '/notebook/people/Jordan-Davis.md',
      null,
      'Which email address for Jordan Davis: jordan@example.com or jordan.work@example.com?',
    ],
  })
  notebook.people.set(
    '/notebook/people/Jordan-Davis.md',
    '---\nname: [Jordan Davis, JD]\nemail: jordan@example.com\n---\n',
  )
  const resolved = resolveInvitee('JD', meetingPeople(notebook, 'JD', scores))
  assert({
    given: 'one stored address for the matched alias',
    should: 'prepare that guest without asking the user to supply the address',
    actual: resolved.selected,
    expected: { name: 'Jordan Davis', email: 'jordan@example.com' },
  })
})

test('calendar matching distinguishes a unique direct name match from namesakes', () => {
  const jordan = {
    id: 'jordan',
    name: 'Jordan Davis',
    aliases: ['JD'],
    hint: '',
    emails: ['jordan@example.com'],
    interactionScore: 100,
  }
  const jane = {
    id: 'jane',
    name: 'Jane Dawson',
    hint: '',
    emails: ['jane@jordan.example.com'],
    interactionScore: 1_000,
  }
  const namesake = { ...jordan, id: 'namesake', name: 'Jordan Dean', emails: ['dean@example.com'], interactionScore: 1 }
  assert({
    given: 'a direct name prefix with a weaker domain match, followed by shared initials or first names',
    should: 'resolve the direct match but leave equal-quality identities for the user regardless of score',
    actual: [
      resolveInvitee('Jordan', [jordan, jane]).selected,
      resolveInvitee('JD', [jordan, namesake]).personId,
      resolveInvitee('Jordan', [jordan, namesake]).selected,
    ],
    expected: [{ name: 'Jordan Davis', email: 'jordan@example.com' }, undefined, null],
  })
})
