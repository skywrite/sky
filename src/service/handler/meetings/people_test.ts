import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { INTERACTION_WEIGHTS, Store } from '../../store.ts'
import { meetingPeople } from './people.ts'

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
