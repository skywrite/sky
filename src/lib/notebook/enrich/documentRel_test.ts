import { resolveTimeRef } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import {
  type DocumentMention,
  type DocumentRelInput,
  type DocumentRelServices,
  documentReferenceWindows,
  documentTimeRef,
  mergeDocumentRel,
  resolveDocumentRel,
} from './documentRel.ts'

const REF = '2026-01-23/actions/meetings/10-00_Atlas-Review.md'
const REL = '2026-01-23/actions/meetings/10-00_Atlas-Review'
const OTHER = '2026-01-23/actions/meetings/15-00_Atlas-Planning.md'
const CONTENT = '---\nwho: Jane Doe\nsummary: Atlas review\nwhen: 2026-01-23 10:00\n---\nWe reviewed the launch budget.'
const INPUT: DocumentRelInput = {
  turns: [
    { role: 'user', content: "Let's unpack my meeting with Jane.", when: '2026-01-25 09:00' },
    { role: 'assistant', content: 'You reviewed the launch budget together.', when: '2026-01-25 09:01' },
  ],
  today: '2026-02-01',
  baseDir: '/notebook',
  contextPaths: [],
}
const MENTION: DocumentMention = {
  message: 0,
  quote: 'my meeting with Jane',
  terms: ['Jane Doe'],
  type: 'meeting',
  path: null,
  dateGte: null,
  dateLte: null,
}

function services(over: Partial<DocumentRelServices> = {}): DocumentRelServices {
  return {
    extract: async () => [MENTION],
    search: async () => [`/notebook/${resolveTimeRef(REF)}`],
    read: async () => CONTENT,
    match: async () => [REF],
    reportError: async (message) => {
      throw new Error(`Unexpected resolver failure: ${message}`)
    },
    ...over,
  }
}

test('document rel - a conversational meeting reference resolves without a filename or date', async () => {
  const lookups: unknown[] = []
  let details = ''
  let conversation = ''
  const refs = await resolveDocumentRel(
    INPUT,
    services({
      search: async (where) => {
        lookups.push(where)
        return [`/notebook/${resolveTimeRef(REF)}`]
      },
      match: async (_mention, text, candidates) => {
        conversation = text
        details = candidates[0].details
        return [candidates[0].ref]
      },
    }),
  )
  assert({
    given: 'a unique meeting mentioned informally',
    should: 'record its time ref without the file extension',
    actual: refs,
    expected: [REL],
  })
  assert({
    given: 'the matching pass',
    should: 'see attendees, the summary, and the original message date instead of the later save date',
    actual: [details.includes('Jane Doe'), details.includes('Atlas review'), conversation.includes('2026-01-25 09:00')],
    expected: [true, true, true],
  })
  assert({
    given: 'no date stated in the conversation',
    should: 'search matching records without inventing a date restriction',
    actual: lookups,
    expected: [
      { pathContains: '/time/', type: 'meeting', involves: 'Jane Doe' },
      { pathContains: '/time/', type: 'meeting', bodyContains: 'Jane Doe' },
      { pathContains: 'Jane Doe', type: 'meeting' },
    ],
  })
})

test('document rel - ambiguous records and unrelated background candidates produce no link', async () => {
  for (const matches of [[REF, OTHER], []]) {
    const refs = await resolveDocumentRel(
      INPUT,
      services({
        search: async () => [REF, OTHER],
        match: async () => matches,
      }),
    )
    assert({
      given: `a judgment with ${matches.length} plausible matches`,
      should: 'abstain',
      actual: refs,
      expected: undefined,
    })
  }
})

test('document rel - loaded context is not evidence of a reference', async () => {
  let searches = 0
  const refs = await resolveDocumentRel(
    { ...INPUT, contextPaths: [resolveTimeRef(REF)] },
    services({
      extract: async () => [{ ...MENTION, quote: 'a meeting never mentioned in the conversation' }],
      search: async () => {
        searches++
        return [REF]
      },
    }),
  )
  assert({
    given: 'a candidate with no quoted reference in a turn',
    should: 'neither search nor relate it',
    actual: { refs, searches },
    expected: { refs: undefined, searches: 0 },
  })
})

test('document rel - reference detection sees the conversation before candidate paths', async () => {
  const seen: string[] = []
  let searched = false
  const refs = await resolveDocumentRel(
    {
      ...INPUT,
      turns: [{ role: 'user', content: 'What should my strategy for Atlas be?' }],
      contextPaths: [resolveTimeRef(REF)],
    },
    services({
      extract: async (...args) => {
        seen.push(...args)
        return []
      },
      search: async () => {
        searched = true
        return [REF]
      },
    }),
  )
  assert({
    given: 'a general topic with a related meeting in background context',
    should: 'keep the meeting out of detection and do no relationship lookup',
    actual: { refs, searched, candidateShown: seen.some((text) => text.includes('Atlas-Review')) },
    expected: { refs: undefined, searched: false, candidateShown: false },
  })
})

test('document rel - generic search terms cannot swamp a unique named meeting', async () => {
  const refs = await resolveDocumentRel(
    INPUT,
    services({
      extract: async () => [{ ...MENTION, terms: ['Jane', 'meeting', 'Friday'] }],
      search: async (where) => {
        if (
          [where.involves, where.bodyContains, where.pathContains].some(
            (value) => value === 'meeting' || value === 'Friday',
          )
        ) {
          throw new Error('generic search terms must not be queried')
        }
        return [REF]
      },
    }),
  )
  assert({
    given: 'a name plus generic words from the reference',
    should: 'resolve through the distinctive name',
    actual: refs,
    expected: [REL],
  })
})

test('document rel - an explicit old-layout path is verified at its current location', async () => {
  const old = 'time/2026/01/19-25/01-23/actions/meetings/10-00_Atlas-Review.md'
  const reads: string[] = []
  const refs = await resolveDocumentRel(
    { ...INPUT, turns: [{ role: 'assistant', content: `See [the meeting](${old}).` }] },
    services({
      extract: async () => [{ ...MENTION, quote: old, path: old, terms: [] }],
      search: async () => {
        throw new Error('an exact cited path needs no speculative search')
      },
      read: async (file) => {
        reads.push(file)
        return CONTENT
      },
    }),
  )
  assert({
    given: 'a cited meeting path from an older folder layout',
    should: 'write the ref without an extension while reading the actual markdown file',
    actual: { refs, reads },
    expected: { refs: [REL], reads: [resolveTimeRef(REF)] },
  })
})

test('document rel - model-invented paths and selections cannot enter rel', async () => {
  let reads = 0
  const guessed = await resolveDocumentRel(
    INPUT,
    services({
      extract: async () => [{ ...MENTION, path: REF, terms: [] }],
      read: async () => {
        reads++
        return CONTENT
      },
    }),
  )
  const fabricated = await resolveDocumentRel(INPUT, services({ match: async () => [OTHER] }))
  assert({
    given: 'a guessed lookup path and an out-of-candidate match',
    should: 'reject both',
    actual: { guessed, fabricated, reads },
    expected: { guessed: undefined, fabricated: undefined, reads: 0 },
  })
})

test('document rel - a capped search cannot establish a unique match', async () => {
  let matched = false
  const refs = await resolveDocumentRel(
    INPUT,
    services({
      search: async (_where, limit) => Array.from({ length: limit }, (_, i) => REF.replace('10-00', `10-${i}`)),
      match: async () => {
        matched = true
        return [REF]
      },
    }),
  )
  assert({
    given: 'more search hits than the candidate budget',
    should: 'abstain before selection',
    actual: { refs, matched },
    expected: { refs: undefined, matched: false },
  })
})

test('document rel - missing files and the chat itself are never candidates', async () => {
  let matched = false
  const missing = await resolveDocumentRel(
    INPUT,
    services({
      read: async () => null,
      match: async () => {
        matched = true
        return [REF]
      },
    }),
  )
  const self = await resolveDocumentRel(
    { ...INPUT, excludePaths: [REF] },
    services({
      match: async () => {
        matched = true
        return [REF]
      },
    }),
  )
  assert({
    given: 'a deleted record and a self reference',
    should: 'skip both',
    actual: { missing, self, matched },
    expected: { missing: undefined, self: undefined, matched: false },
  })
})

test('document rel - repeated references and overlapping extraction windows deduplicate', async () => {
  let reads = 0
  const refs = await resolveDocumentRel(
    INPUT,
    services({
      extract: async () => [MENTION, MENTION, { ...MENTION, quote: 'meeting with Jane' }],
      read: async () => {
        reads++
        return CONTENT
      },
    }),
  )
  assert({
    given: 'three extractions of the same referenced meeting',
    should: 'record and read it once',
    actual: { refs, reads },
    expected: { refs: [REL], reads: 1 },
  })
})

test('document rel - lookup failure abstains without failing the save', async () => {
  const errors: string[] = []
  const refs = await resolveDocumentRel(
    INPUT,
    services({
      search: async () => {
        throw new Error('service unavailable')
      },
      reportError: async (message) => {
        errors.push(message)
      },
    }),
  )
  assert({
    given: 'an unavailable notebook service',
    should: 'report the failed enrichment and return no refs',
    actual: { refs, errors },
    expected: { refs: undefined, errors: ['service unavailable'] },
  })
})

test('document rel - extraction keeps references buried inside long conversations', () => {
  const content = `${'background '.repeat(4000)}my meeting with Jane${' closing'.repeat(4000)}`
  const windows = documentReferenceWindows([{ role: 'user', content, when: '2026-01-25 09:00' }], INPUT.today)
  assert({
    given: 'a reference beyond the ordinary classifier transcript budget',
    should: 'reach extraction with its message number and original timestamp',
    actual: windows.some(
      (window) => window.includes('my meeting with Jane') && window.includes('Message 0 (user, 2026-01-25 09:00)'),
    ),
    expected: true,
  })
})

test('document rel - canonicalization refuses non-notebook paths and invalid dates', () => {
  assert({
    given: 'foreign, traversing, non-time, and invalid-date paths',
    should: 'produce no time ref',
    actual: [
      '/elsewhere/time/2026/W04/01-23/actions/meetings/review.md',
      '2026-01-23/../../people/Jane-Doe.md',
      'people/Jane-Doe.md',
      '2026-02-31/actions/meetings/review.md',
    ].map((p) => documentTimeRef(p, INPUT.baseDir)),
    expected: [undefined, undefined, undefined, undefined],
  })
})

test('document rel - window boundaries preserve Unicode', () => {
  const content = `${'x'.repeat(23_999)}🙂${'y'.repeat(23_999)}🙂`
  const windows = documentReferenceWindows([{ role: 'user', content }], INPUT.today)
  assert({
    given: 'emoji crossing extraction boundaries',
    should: 'send only well-formed text to the model',
    actual: windows.every((window) => window.isWellFormed()),
    expected: true,
  })
})

test('document rel - a later lookup failure preserves earlier resolved references', async () => {
  const errors: string[] = []
  const refs = await resolveDocumentRel(
    { ...INPUT, turns: [...INPUT.turns, { role: 'user', content: 'And the budget note?' }] },
    services({
      extract: async () => [MENTION, { ...MENTION, message: 2, quote: 'the budget note', terms: ['budget'] }],
      search: async (where) => {
        if (Object.values(where).includes('budget')) throw new Error('second lookup unavailable')
        return [REF]
      },
      reportError: async (message) => {
        errors.push(message)
      },
    }),
  )
  assert({
    given: 'one resolved meeting followed by a failed lookup',
    should: 'keep the resolved relationship and report the failure',
    actual: { refs, errors },
    expected: { refs: [REL], errors: ['second lookup unavailable'] },
  })
})

test('document rel - existing short refs, paths, and titled links retain their spelling', () => {
  const forms = [REL, REF, REF.slice(5), REF.slice(8), resolveTimeRef(REF), `[Review](${REF.slice(8)})`]
  const later = '2026-01-23/actions/meetings/15-00_Atlas-Planning'
  assert({
    given: 'each existing spelling of the same meeting, plus a new meeting',
    should: 'append only the new relationship and preserve hand-written entries',
    actual: forms.map((form) =>
      mergeDocumentRel(['projects/Atlas', form], [REL, later, later], INPUT.baseDir, '2026-01-25'),
    ),
    expected: forms.map((form) => ['projects/Atlas', form, later]),
  })
})
