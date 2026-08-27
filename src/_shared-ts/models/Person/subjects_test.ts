import { assert, test } from '#test'
import { findPersonSubjects, type PersonIndexEntry } from './subjects.ts'

function entry(names: string[], path: string): PersonIndexEntry {
  return { name: names[0], names, path }
}

/** Reader over an in-memory profile map — what the service transport does in production. */
function reader(profiles: Record<string, string>) {
  return async (path: string) => profiles[path] ?? null
}

const INDEX = [
  entry(['Taylor Quinn', 'Taylor'], 'people/2025/ta/Taylor-Quinn.md'),
  entry(['Art Vega', 'Art'], 'people/2025/ar/Art-Vega.md'),
  entry(['Will Park', 'Will'], 'people/2025/wi/Will-Park.md'),
  entry(['Jane Doe', 'Jane'], 'people/2020/ja/Jane-Doe.md'),
]

const PROFILES = Object.fromEntries(
  INDEX.map((e) => [e.path, `---\nname: ${e.name}\n---\n\n# ${e.name}\n\n## Background\n`]),
)

test('findPersonSubjects - matches whole names, aliases collapse to one subject', async () => {
  const subjects = await findPersonSubjects({
    transcript: 'Talked to Taylor Quinn about the launch; taylor quinn will send notes. Arthur is unrelated.',
    index: INDEX,
    readDocument: reader(PROFILES),
  })

  assert({
    given: 'a transcript naming one person twice by full name and a near-miss substring',
    should: 'return the one person once, with their profile, and never match Art inside Arthur',
    actual: {
      names: subjects.map((s) => s.name),
      hasProfile: subjects[0]?.markdown.includes('# Taylor Quinn'),
    },
    expected: { names: ['Taylor Quinn'], hasProfile: true },
  })
})

test('findPersonSubjects - a single-word name matches only capitalized, sparing the prose word', async () => {
  const [everyday, named] = await Promise.all([
    findPersonSubjects({
      transcript: 'We will go tomorrow, and it will be fine.',
      index: INDEX,
      readDocument: reader(PROFILES),
    }),
    findPersonSubjects({
      transcript: 'Will said the vendor is ready.',
      index: INDEX,
      readDocument: reader(PROFILES),
    }),
  ])

  assert({
    given: 'the modal verb in prose versus the capitalized name',
    should: 'match only the name',
    actual: { everyday: everyday.map((s) => s.name), named: named.map((s) => s.name) },
    expected: { everyday: [], named: ['Will Park'] },
  })
})

test('findPersonSubjects - the user is excluded and the limit keeps the most mentioned', async () => {
  const subjects = await findPersonSubjects({
    transcript:
      'Jane met Taylor Quinn twice — Taylor Quinn agreed. Art Vega joined once. Will Park was mentioned in passing.',
    index: INDEX,
    readDocument: reader(PROFILES),
    excludeNames: ['Jane'],
    limit: 2,
  })

  assert({
    given: 'the user among four matched people and a limit of two',
    should: 'drop the user, rank by mentions, and cut at the limit',
    actual: subjects.map((s) => s.name),
    expected: ['Taylor Quinn', 'Art Vega'],
  })
})

test('findPersonSubjects - blank transcripts, unreadable profiles, and empty indexes degrade to nothing', async () => {
  const [blank, unreadable, empty] = await Promise.all([
    findPersonSubjects({ transcript: '   ', index: INDEX, readDocument: reader(PROFILES) }),
    findPersonSubjects({
      transcript: 'Taylor Quinn was here.',
      index: INDEX,
      readDocument: async () => {
        throw new Error('service down')
      },
    }),
    findPersonSubjects({ transcript: 'Taylor Quinn was here.', index: [], readDocument: reader(PROFILES) }),
  ])
  assert({
    given: 'a blank transcript, a reader that throws, and an empty index',
    should: 'return no subjects rather than throwing',
    actual: { blank, unreadable, empty },
    expected: { blank: [], unreadable: [], empty: [] },
  })
})
