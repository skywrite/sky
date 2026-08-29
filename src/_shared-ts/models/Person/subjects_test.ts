import { assert, test } from '#test'
import { findPersonSubjects, type PersonIndexEntry, profilesAnsweringTo, screenUnlisted } from './subjects.ts'

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

// Namesakes: three profiles share a first name, and a fourth, rarely seen,
// carries the bare name as an explicit alias.
const SAMS = [
  entry(['Sam Rivera'], 'people/2026/sa/Sam-Rivera.md'),
  entry(['Sam Okafor'], 'people/2025/sa/Sam-Okafor.md'),
  entry(['Sam Lindqvist'], 'people/2024/sa/Sam-Lindqvist.md'),
  entry(['Casey Morgan', 'Sam'], 'people/2010/ca/Casey-Morgan.md'),
]
const SAM_PROFILES = Object.fromEntries(SAMS.map((e) => [e.path, `---\nname: ${e.name}\n---\n\n# ${e.name}\n`]))
const SAM_SCORES: Record<string, number> = { 'Sam Rivera': 12, 'Sam Okafor': 5, 'Sam Lindqvist': 1 }
const samScore = (name: string) => SAM_SCORES[name] ?? 0

test('findPersonSubjects - a bare first name makes every namesake a candidate, top two by score', async () => {
  const [scored, unscored] = await Promise.all([
    findPersonSubjects({
      transcript: 'Sam and compliance should look at the ownership before KYB.',
      index: SAMS,
      readDocument: reader(SAM_PROFILES),
      scoreFor: samScore,
    }),
    findPersonSubjects({
      transcript: 'Sam and compliance should look at the ownership before KYB.',
      index: SAMS,
      readDocument: reader(SAM_PROFILES),
    }),
  ])

  assert({
    given: 'a bare "Sam" among three Sams and a profile with "Sam" as an explicit alias',
    should: 'keep the two highest-scored namesakes — the explicit alias claims no authority',
    actual: scored.map((s) => s.name),
    expected: ['Sam Rivera', 'Sam Okafor'],
  })

  assert({
    given: 'the same transcript without interaction scores',
    should: 'still cut to two, deterministically by name',
    actual: unscored.map((s) => s.name),
    expected: ['Casey Morgan', 'Sam Lindqvist'],
  })
})

test('findPersonSubjects - a full name outranks bare first names and survives the namesake cut', async () => {
  const subjects = await findPersonSubjects({
    transcript: 'Sam Lindqvist sent the deck; Sam will follow up on pricing.',
    index: SAMS,
    readDocument: reader(SAM_PROFILES),
    scoreFor: samScore,
  })

  assert({
    given: 'the lowest-scored Sam named in full, plus a bare "Sam"',
    should: 'rank the full name first and still add the two likeliest namesakes for the bare one',
    actual: subjects.map((s) => s.name),
    expected: ['Sam Lindqvist', 'Sam Rivera', 'Sam Okafor'],
  })
})

test('findPersonSubjects - a handle the transcript also uses in lowercase is prose, not a name', async () => {
  const index = [...INDEX, entry(['The Market Maker'], 'people/2019/th/The-Market-Maker.md')]
  const profiles = { ...PROFILES, 'people/2019/th/The-Market-Maker.md': '---\nname: The Market Maker\n---\n' }
  const [prose, named] = await Promise.all([
    findPersonSubjects({
      transcript:
        'The economics look thin. The floor is fixed, and the growth funds pass through. Will you check? We will.',
      index,
      readDocument: reader(profiles),
    }),
    findPersonSubjects({
      transcript: 'Will you check the deck? We will need it. The Market Maker wants numbers by Friday.',
      index,
      readDocument: reader(profiles),
    }),
  ])

  assert({
    given: 'sentence-initial "The" and "Will" alongside their lowercase forms',
    should: 'match nobody — neither the first-name handle nor the explicit alias counts',
    actual: prose.map((s) => s.name),
    expected: [],
  })

  assert({
    given: 'the same prose words plus the full name',
    should: 'still match the full name, which needs no capitalization signal',
    actual: named.map((s) => s.name),
    expected: ['The Market Maker'],
  })
})

test('profilesAnsweringTo - exact aliases, first names, surnames, and multi-word subsets all answer', () => {
  const index = [
    ...INDEX,
    entry(['Sam Rivera Ortiz', 'Sam'], 'people/2024/sa/Sam-Rivera-Ortiz.md'),
    entry(['Sam Okafor'], 'people/2023/sa/Sam-Okafor.md'),
  ]
  const names = (name: string) => profilesAnsweringTo(name, index).map((e) => e.name)

  assert({
    given: 'names as the model writes them, from an exact alias down to a bare surname',
    should: 'return every profile answering to each, and none for a stranger or a two-letter name',
    actual: {
      exact: names('jane doe'),
      subset: names('Sam Ortiz'),
      first: names('Sam'),
      surname: names('Okafor'),
      stranger: names('Riley Voss'),
      short: names('Sa'),
    },
    expected: {
      exact: ['Jane Doe'],
      subset: ['Sam Rivera Ortiz'],
      first: ['Sam Rivera Ortiz', 'Sam Okafor'],
      surname: ['Sam Okafor'],
      stranger: [],
      short: [],
    },
  })
})

test('screenUnlisted - qualifiers stripped, duplicates collapsed, existing profiles attached', () => {
  const screened = screenUnlisted(
    [
      { name: 'Jane Doe (Atlas)', gist: 'runs the Atlas rollout' },
      { name: 'Jane Doe', gist: 'named again' },
      { name: 'Riley Voss', gist: 'introduced the vendor' },
      { name: 'Taylor', gist: 'sent the deck' },
    ],
    INDEX,
  )

  assert({
    given: 'model names with a parenthetical qualifier, a duplicate, a stranger, and a bare first name',
    should: 'keep one clean entry each, carrying the profiles that already answer to the name',
    actual: screened,
    expected: [
      { name: 'Jane Doe', gist: 'runs the Atlas rollout', existing: ['Jane Doe'] },
      { name: 'Riley Voss', gist: 'introduced the vendor' },
      { name: 'Taylor', gist: 'sent the deck', existing: ['Taylor Quinn'] },
    ],
  })
})
