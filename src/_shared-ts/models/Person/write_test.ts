import { assert, test } from '#test'
import PersonDocument from './mod.ts'
import {
  applyPersonFacts,
  canonicalizeSections,
  type DocumentIO,
  type DocumentSnapshot,
  joinBodySections,
  MAX_OPS_PER_PERSON,
  MAX_PEOPLE_PER_SAVE,
  MAX_UNLISTED_PER_SAVE,
  type PersonFacts,
  type PersonOp,
  splitBodySections,
} from './write.ts'

const TODAY = '2026-02-01'
const PATH = 'people/2026/ta/Taylor-Quinn.md'
const SUBJECT = { name: 'Taylor Quinn', path: PATH }

const PROFILE = [
  '---',
  'name: Taylor Quinn',
  'location:',
  'email:',
  '  personal:',
  '  business: taylor@example.com',
  'sites:',
  '  - https://example.com/taylor',
  'created: 2026-01-10',
  'updated: 2026-01-10',
  'met: 2026-01-10',
  'tags:',
  '---',
  '',
  '# Taylor Quinn',
  '',
  '## Background',
  '',
  'Met at the Atlas kickoff.',
  '',
  '### Career',
  '',
  'Ten years at Example Corp.',
  '',
  '## Family / Relationships',
  '',
  'Partner: Jordan.',
  '',
  '## Info',
  '',
  '- https://example.com/taylor',
  '',
].join('\n')

/**
 * In-memory stand-in for the service transport: version bumps on every
 * accepted save, a stale version conflicts with the current snapshot —
 * the same contract the saveDocument mutation implements.
 */
function memoryIO(files: Record<string, string>): DocumentIO & { content(path: string): string; saves: number } {
  const store = new Map(Object.entries(files).map(([p, content]) => [p, { content, version: 1 }]))
  return {
    saves: 0,
    read: async (path): Promise<DocumentSnapshot | null> => {
      const entry = store.get(path)
      return entry ? { path, content: entry.content, version: entry.version } : null
    },
    async save(path, content, version) {
      const entry = store.get(path)
      if (!entry) throw new Error(`Document not found: ${path}`)
      if (entry.version !== version) return { saved: false, current: { path, ...entry } }
      store.set(path, { content, version: version + 1 })
      this.saves += 1
      return { saved: true }
    },
    content: (path) => store.get(path)?.content ?? '',
  }
}

async function applyOps(ops: PersonOp[], contents = PROFILE) {
  const io = memoryIO({ [PATH]: contents })
  const outcomes = await applyPersonFacts({
    facts: [{ name: SUBJECT.name, ops }],
    unlisted: [],
    subjects: [SUBJECT],
    today: TODAY,
    io,
  })
  return { outcomes, after: io.content(PATH), io }
}

// -----------------------------------------------------------------------------
// Section surgery
// -----------------------------------------------------------------------------

test('splitBodySections - h2 boundaries only, h3 stays inside its parent', () => {
  const split = splitBodySections('# Taylor\n\nLead line.\n\n## Background\n\nProse.\n\n### Career\n\nMore.\n')
  assert({
    given: 'a body with a preamble, a section, and a nested h3',
    should: 'keep the h3 inside the section body and the lead in the preamble',
    actual: {
      preamble: split.preamble,
      headings: split.sections.map((s) => s.heading),
      body: split.sections[0].body,
    },
    expected: {
      preamble: '# Taylor\n\nLead line.',
      headings: ['Background'],
      body: 'Prose.\n\n### Career\n\nMore.',
    },
  })
})

test('canonicalizeSections - legacy headings rename and same-named sections merge, dropping nothing', () => {
  const split = canonicalizeSections(
    splitBodySections(
      ['# T', '', '## Family / Relationships', '', 'Partner: Jordan.', '', '## Family', '', 'Kids: two.', ''].join(
        '\n',
      ),
    ),
  )
  assert({
    given: 'a legacy Family / Relationships heading colliding with a Family section',
    should: 'merge them under the canonical name with both bodies intact',
    actual: { headings: split.sections.map((s) => s.heading), body: split.sections[0].body },
    expected: { headings: ['Family'], body: 'Partner: Jordan.\n\nKids: two.' },
  })
})

test('joinBodySections - an empty section keeps its heading', () => {
  const body = joinBodySections({ preamble: '# T', sections: [{ heading: 'Overview', body: '' }] })
  assert({
    given: 'a section with no content yet',
    should: 'render the heading alone rather than dropping it',
    actual: body,
    expected: '# T\n\n## Overview\n',
  })
})

// -----------------------------------------------------------------------------
// Ops
// -----------------------------------------------------------------------------

test('applyPersonFacts - overview lands as the first section and rewrites in place', async () => {
  const first = await applyOps([{ op: 'overview', body: 'Platform lead at Example Corp; met via Atlas.' }])
  const doc = PersonDocument.fromMarkdown(first.after)
  const split = splitBodySections(doc.toMarkdown({ yaml: false }))
  assert({
    given: 'a profile with no Overview',
    should: 'create it ahead of every existing section and bump updated',
    actual: {
      outcome: first.outcomes[0].outcome,
      headings: split.sections.map((s) => s.heading),
      overview: split.sections[0].body,
      updated: doc.yaml['updated'],
    },
    expected: {
      outcome: 'applied',
      headings: ['Overview', 'Background', 'Family', 'Info'],
      overview: 'Platform lead at Example Corp; met via Atlas.',
      updated: TODAY,
    },
  })

  const second = await applyOps(
    [{ op: 'overview', body: '## Rewritten\nNow running the vendor program.' }],
    first.after,
  )
  const rewritten = splitBodySections(PersonDocument.fromMarkdown(second.after).toMarkdown({ yaml: false }))
  assert({
    given: 'a second overview carrying a stray heading marker',
    should: 'replace the section wholesale with the markers stripped',
    actual: {
      overview: rewritten.sections[0].body,
      count: rewritten.sections.filter((s) => s.heading === 'Overview').length,
    },
    expected: { overview: 'Rewritten\nNow running the vendor program.', count: 1 },
  })
})

test('applyPersonFacts - notes append, dedupe exactly, and create their section at the end', async () => {
  const { outcomes, after } = await applyOps([
    { op: 'note', section: 'Family', text: 'Partner: Jordan.' },
    { op: 'note', section: 'Family', text: 'Anniversary: June 12.' },
    { op: 'note', section: 'Background', text: 'Pronounced TAY-lor KWIN.' },
  ])

  assert({
    given: 'a duplicate line, a fresh line, and a line for another section',
    should: 'skip the duplicate and append the rest',
    actual: outcomes.map((o) => o.outcome),
    expected: ['skipped', 'applied', 'applied'],
  })

  const split = splitBodySections(PersonDocument.fromMarkdown(after).toMarkdown({ yaml: false }))
  const family = split.sections.find((s) => s.heading === 'Family')
  assert({
    given: 'the rewritten file',
    should: 'carry the legacy heading canonicalized, the old line once, and the new line appended',
    actual: family?.body,
    expected: 'Partner: Jordan.\n\nAnniversary: June 12.',
  })
})

test('applyPersonFacts - fields fill only when empty; sites dedupe', async () => {
  const { outcomes, after } = await applyOps([
    { op: 'field', field: 'location', value: 'Lisbon' },
    { op: 'field', field: 'location', value: 'Porto' },
    { op: 'site', url: 'https://example.com/taylor' },
    { op: 'site', url: 'https://example.org/tq' },
  ])

  assert({
    given: 'a fill on an empty field, a second fill, a known site, and a new one',
    should: 'apply first-wins on the field and add only the new site',
    actual: outcomes.map((o) => ({ outcome: o.outcome, reason: o.reason })),
    expected: [
      { outcome: 'applied', reason: undefined },
      { outcome: 'skipped', reason: 'location already set' },
      { outcome: 'skipped', reason: 'already listed' },
      { outcome: 'applied', reason: undefined },
    ],
  })

  const doc = PersonDocument.fromMarkdown(after)
  assert({
    given: 'the rewritten frontmatter',
    should: 'hold the filled location and both sites',
    actual: { location: doc.location, sites: Array.from(doc.sites) },
    expected: { location: 'Lisbon', sites: ['https://example.com/taylor', 'https://example.org/tq'] },
  })
})

test('applyPersonFacts - preferred name reorders the list per the index-0 convention', async () => {
  const { after } = await applyOps([{ op: 'preferred-name', preferred: 'TQ' }])
  assert({
    given: 'a scalar name and an explicit goes-by',
    should: 'become a list with the preferred name first and the legal name kept',
    actual: PersonDocument.fromMarkdown(after).names,
    expected: ['TQ', 'Taylor Quinn'],
  })

  const again = await applyOps([{ op: 'preferred-name', preferred: 'taylor quinn' }], after)
  assert({
    given: 'a goes-by matching an existing entry in different case',
    should: 'move the hand-written spelling to the front, dropping nothing',
    actual: {
      names: PersonDocument.fromMarkdown(again.after).names,
      outcome: again.outcomes[0].outcome,
    },
    expected: { names: ['Taylor Quinn', 'TQ'], outcome: 'applied' },
  })
})

// -----------------------------------------------------------------------------
// Guards
// -----------------------------------------------------------------------------

test('applyPersonFacts - nothing is ever deleted', async () => {
  const { after } = await applyOps([
    { op: 'overview', body: 'The full current picture.' },
    { op: 'note', section: 'Info', text: 'Goes by TQ on chat.' },
    { op: 'field', field: 'title', value: 'Platform Lead' },
  ])
  // updated: moves by design; the legacy Family heading survives renamed.
  const originalLines = PROFILE.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('---') && !l.startsWith('updated:') && l !== '## Family / Relationships')
  assert({
    given: 'a barrage of ops against the profile',
    should: 'keep every original content line (the renamed heading survives as ## Family)',
    actual: {
      kept: originalLines.every((l) => after.includes(l)),
      missing: originalLines.filter((l) => !after.includes(l)),
      family: after.includes('## Family'),
    },
    expected: { kept: true, missing: [], family: true },
  })
})

test('applyPersonFacts - a save where every op skips never writes at all', async () => {
  const { outcomes, io } = await applyOps([{ op: 'site', url: 'https://example.com/taylor' }])
  assert({
    given: 'ops that all deduped away',
    should: 'not save the document — canonicalization alone never churns',
    actual: { outcomes: outcomes.map((o) => o.outcome), saves: io.saves, content: io.content(PATH) },
    expected: { outcomes: ['skipped'], saves: 0, content: PROFILE },
  })
})

test('applyPersonFacts - a version conflict re-applies against the fresh content once', async () => {
  const io = memoryIO({ [PATH]: PROFILE })
  const handEdited = PROFILE.trimEnd() + '\n\nHand-added while saving.\n'
  let conflicts = 0
  let savedContent = ''
  // First save loses to a concurrent hand edit; the retry must carry the
  // conflict snapshot's version to be accepted.
  io.save = async (path, content, version) => {
    if (conflicts === 0) {
      conflicts += 1
      return { saved: false, current: { path, content: handEdited, version: 2 } }
    }
    if (version !== 2) return { saved: false, current: { path, content: handEdited, version: 2 } }
    io.saves += 1
    savedContent = content
    return { saved: true }
  }

  const outcomes = await applyPersonFacts({
    facts: [{ name: SUBJECT.name, ops: [{ op: 'field', field: 'location', value: 'Lisbon' }] }],
    unlisted: [],
    subjects: [SUBJECT],
    today: TODAY,
    io,
  })

  assert({
    given: 'a save that conflicted once with a concurrent edit',
    should: 're-apply against the returned snapshot, keeping the concurrent line and the op',
    actual: {
      outcomes: outcomes.map((o) => o.outcome),
      conflicts,
      saves: io.saves,
      keptHandEdit: savedContent.includes('Hand-added while saving.'),
      keptOp: savedContent.includes('location: Lisbon'),
    },
    expected: { outcomes: ['applied'], conflicts: 1, saves: 1, keptHandEdit: true, keptOp: true },
  })
})

test('applyPersonFacts - unknown and unlisted people become person:new hints, never writes', async () => {
  const io = memoryIO({ [PATH]: PROFILE })
  const outcomes = await applyPersonFacts({
    facts: [{ name: 'Sam Note', ops: [{ op: 'field', field: 'location', value: 'Berlin' }] }],
    unlisted: [{ name: 'Riley Voss', gist: 'introduced the vendor' }],
    subjects: [SUBJECT],
    today: TODAY,
    io,
  })
  assert({
    given: 'a fact for a name outside the subjects and an unlisted person',
    should: 'surface both as skipped hints carrying the person:new command',
    actual: outcomes.map((o) => ({ op: o.op, person: o.person, outcome: o.outcome, reason: o.reason })),
    expected: [
      { op: 'unknown', person: 'Sam Note', outcome: 'skipped', reason: 'no profile (sky person:new "Sam Note")' },
      { op: 'unknown', person: 'Riley Voss', outcome: 'skipped', reason: 'no profile (sky person:new "Riley Voss")' },
    ],
  })
})

test('applyPersonFacts - an unlisted name existing profiles answer to reports them, never person:new', async () => {
  const io = memoryIO({ [PATH]: PROFILE })
  const outcomes = await applyPersonFacts({
    facts: [],
    unlisted: [
      { name: 'Sam', gist: 'ran the demo', existing: ['Sam Rivera', 'Sam Okafor', 'Sam Lindqvist', 'Sam Park'] },
      { name: 'Riley Voss', gist: 'introduced the vendor', existing: [] },
    ],
    subjects: [SUBJECT],
    today: TODAY,
    io,
  })

  assert({
    given: 'an unlisted name four profiles answer to, and one nobody does',
    should: 'name the first three profiles and count the rest; hint person:new only for the stranger',
    actual: { reasons: outcomes.map((o) => o.reason), saves: io.saves },
    expected: {
      reasons: [
        'profile exists: Sam Rivera, Sam Okafor, Sam Lindqvist +1 more',
        'no profile (sky person:new "Riley Voss")',
      ],
      saves: 0,
    },
  })
})

test('applyPersonFacts - unlisted lines past the cap fold into one', async () => {
  const io = memoryIO({ [PATH]: PROFILE })
  const unlisted = Array.from({ length: MAX_UNLISTED_PER_SAVE + 2 }, (_, i) => ({
    name: `Person ${i}`,
    gist: `gist ${i}`,
  }))
  const outcomes = await applyPersonFacts({ facts: [], unlisted, subjects: [SUBJECT], today: TODAY, io })

  assert({
    given: `${MAX_UNLISTED_PER_SAVE + 2} unlisted people`,
    should: 'render the first cap-many as lines and the rest as one folded line naming them',
    actual: { lines: outcomes.length, last: outcomes.at(-1), saves: io.saves },
    expected: {
      lines: MAX_UNLISTED_PER_SAVE + 1,
      last: {
        op: 'unknown',
        person: '2 more',
        summary: `Person ${MAX_UNLISTED_PER_SAVE}, Person ${MAX_UNLISTED_PER_SAVE + 1}`,
        outcome: 'skipped',
        reason: 'per-save unlisted cap',
      },
      saves: 0,
    },
  })
})

test('applyPersonFacts - the people and per-person op caps skip the excess visibly', async () => {
  const files: Record<string, string> = {}
  const subjects: Array<{ name: string; path: string }> = []
  const facts: PersonFacts[] = []
  for (let i = 0; i < MAX_PEOPLE_PER_SAVE + 1; i++) {
    const name = `Person ${'ABCDE'[i]}`
    const path = `people/2026/pe/person-${i}.md`
    files[path] = `---\nname: ${name}\n---\n\n# ${name}\n`
    subjects.push({ name, path })
    facts.push({ name, ops: [{ op: 'field', field: 'location', value: 'Lisbon' }] })
  }
  const overOps: PersonOp[] = Array.from({ length: MAX_OPS_PER_PERSON + 1 }, (_, i) => ({
    op: 'note',
    section: 'Info',
    text: `Fact number ${i}.`,
  }))
  facts[0] = { name: subjects[0].name, ops: overOps }

  const outcomes = await applyPersonFacts({ facts, unlisted: [], subjects, today: TODAY, io: memoryIO(files) })
  assert({
    given: 'one person over the op cap and one person over the people cap',
    should: 'apply up to each cap and skip the rest with the cap named',
    actual: {
      opCapSkips: outcomes.filter((o) => o.reason === 'per-person op cap').length,
      peopleCapSkips: outcomes.filter((o) => o.reason === 'per-save people cap').length,
      applied: outcomes.filter((o) => o.outcome === 'applied').length,
    },
    expected: { opCapSkips: 1, peopleCapSkips: 1, applied: MAX_OPS_PER_PERSON + MAX_PEOPLE_PER_SAVE - 1 },
  })
})
