import { assert, test } from '#test'
import { mergeRel, proposeRel, selectionEvidence, subsetOf, textWindows, unionSubjects } from './autoRel.ts'
import { normalizeEntityName } from './resolve.ts'

test('mergeRel keeps existing refs first and verbatim', () => {
  assert({
    given: 'pipeline refs and a fresh proposal',
    should: 'append the proposal after them',
    actual: mergeRel(['Jane Doe', 'Acme Corp'], ['projects/Atlas-Rollout']),
    expected: ['Jane Doe', 'Acme Corp', 'projects/Atlas-Rollout'],
  })
})

test('mergeRel drops proposals already present, however they are spelled', () => {
  assert({
    given: 'a proposal matching an existing ref under normalization',
    should: 'keep the existing spelling and add nothing',
    actual: mergeRel(['projects/Atlas-Rollout'], ['projects/atlas rollout', 'Acme Corp']),
    expected: ['projects/Atlas-Rollout', 'Acme Corp'],
  })
  assert({
    given: 'a proposal repeated within itself',
    should: 'add it once',
    actual: mergeRel([], ['Jane Doe', 'jane doe']),
    expected: ['Jane Doe'],
  })
})

test('mergeRel handles either side being absent', () => {
  assert({
    given: 'only proposals',
    should: 'use them',
    actual: mergeRel(undefined, ['Jane Doe']),
    expected: ['Jane Doe'],
  })
  assert({
    given: 'only existing refs',
    should: 'leave them untouched',
    actual: mergeRel(['Jane Doe'], undefined),
    expected: ['Jane Doe'],
  })
  assert({
    given: 'nothing on either side',
    should: 'stay undefined',
    actual: mergeRel(undefined, undefined),
    expected: undefined,
  })
})

test('subsetOf keeps candidates in candidate order, matched loosely, deduped', () => {
  const candidates = ['Jane Doe', 'Acme Corp', 'projects/Atlas-Rollout']

  assert({
    given: 'a reply in a different order and casing, with an invention',
    should: 'keep only real candidates, in candidate order',
    actual: subsetOf(['acme corp', 'JANE DOE', 'Nonsense Inc', 'jane doe'], candidates),
    expected: ['Jane Doe', 'Acme Corp'],
  })
  assert({ given: 'an empty reply', should: 'keep nothing', actual: subsetOf([], candidates), expected: [] })
})

test('textWindows covers the whole text in overlapping windows and leaves a short text whole', () => {
  const text = 'x'.repeat(20_000)
  const windows = textWindows(text, 8000, 500)
  assert({
    given: 'a 20k-character text with an 8k window and 500 overlap',
    should: 'start each window 7,500 after the last and reach the end',
    actual: { count: windows.length, sizes: windows.map((w) => w.length), whole: textWindows('short', 8000) },
    expected: { count: 3, sizes: [8000, 8000, 5000], whole: ['short'] },
  })
})

test('unionSubjects merges windows, dropping respellings and keeping the first', () => {
  const empty = { people: [], orgs: [], projects: [], places: [] }
  const union = unionSubjects([
    { ...empty, orgs: ['Acme Labs'], people: ['Jane Doe'] },
    { ...empty, orgs: ['acme labs', 'Widget Co'], people: ['Jane  Doe', 'John Doe'] },
  ])
  assert({
    given: 'two windows naming the same organization and person in different spellings',
    should: 'keep each once, as first written, in order of appearance',
    actual: { orgs: union.orgs, people: union.people },
    expected: { orgs: ['Acme Labs', 'Widget Co'], people: ['Jane Doe', 'John Doe'] },
  })
})

test('selectionEvidence shows the selector the passages naming a late subject', () => {
  const body = `${'Opening remarks about the launch. '.repeat(400)}The partner on payments is Acme Labs, who sign next week. ${'Closing notes. '.repeat(50)}`
  const evidence = selectionEvidence(body, ['Acme Labs'], 8000)
  assert({
    given: 'a 14k-character body whose organization appears only after the first 8k',
    should: 'stay within budget and include the passage naming it',
    actual: {
      within: evidence.length <= 8000,
      named: evidence.includes('Acme Labs'),
      head: evidence.startsWith('Opening remarks'),
    },
    expected: { within: true, named: true, head: true },
  })
})

test('proposeRel reads a subject named only at the end of a long conversation', async () => {
  const late = 'Acme Labs'
  const body = `${'User: What should the launch plan cover?\n\nAI: The demo, the pricing page, and the announcement. '.repeat(120)}AI: The payments partner is ${late}; they sign next week and own settlement.`
  const windowsRead: string[] = []
  let selectBody = ''
  let selectCandidates: string[] = []
  const proposal = await proposeRel(
    { from: 'JP', summary: 'Launch plan', body },
    { mediums: ['chat'], kind: 'AI chat conversation' },
    {
      buildIndex: async () => ({
        candidates: [{ ref: late, kind: 'org', norm: normalizeEntityName(late), label: late }],
        canResolve: (raw) => normalizeEntityName(raw) === normalizeEntityName(late),
      }),
      fetchScores: async () => new Map(),
      loadCorpus: async () => ({ records: [] }),
      extract: async (req) => {
        windowsRead.push(req.body)
        return {
          subjects: { people: [], orgs: req.body.includes(late) ? [late] : [], projects: [], places: [] },
        }
      },
      select: async (req) => {
        selectBody = req.body
        selectCandidates = req.candidates.map((c) => c.ref)
        return { rel: [late] }
      },
    },
  )
  assert({
    given: 'a 12k-character conversation whose organization appears only in its last sentence',
    should: 'read every window, offer the organization to the selector with the passage naming it, and propose it',
    actual: {
      windows: windowsRead.length > 1,
      lastWindowNamesIt: windowsRead.at(-1)?.includes(late),
      candidates: selectCandidates,
      selectorSawIt: selectBody.includes(late) && selectBody.length <= 8000,
      rel: proposal.rel,
    },
    expected: { windows: true, lastWindowNamesIt: true, candidates: [late], selectorSawIt: true, rel: [late] },
  })
})
