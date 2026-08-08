import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { verdictScore } from '#shared/models/AI/ContextAssembler/mod.ts'
import { createRecencyTypeScorer } from '#shared/models/AI/ContextAssembler/scorers.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { type CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  createChatScorer,
  type DocProvenance,
  extractTopicTerms,
  provenanceBoost,
  strongerTier,
  tierForResultSize,
} from './score.ts'

// Scoring runs over documents read from the fixture notebook — real files
// on disk, like every ChatContext test.
const BASE_DIR = path.join(import.meta.dirname!, 'fixtures', 'notebook')
const TODAY = new PlainDate('2026-01-27')
const abs = (rel: string) => path.join(BASE_DIR, rel)

const FIX = {
  person: abs('people/Jane-Doe.md'),
  meeting: abs('time/2026/01/19-25/01-20/actions/meetings/11-00_Atlas_Sync.md'),
  goal: abs('goals/2026.md'),
  day: abs('time/2026/01/26-01/01-27/day.md'),
  digest: abs('time/2026/01/26-01/01-27/actions/messages/slack_Atlas-Bot-to-atlas-general_Weekly-Digest.md'),
  deal: abs('time/2026/01/26-01/01-27/actions/messages/slack_Ops-to-atlas-deals_Contract-Countersigned.md'),
  vendor: abs('time/2026/01/26-01/01-27/actions/notes/Vendor-Landscape.md'),
}

async function fixtureCollection(absPaths: string[]): Promise<DomainCollection> {
  const docs = await Promise.all(
    absPaths.map(async (p) => ({ doc: Document.fromMarkdown(await readTextFile(p)), path: p })),
  )
  return DomainCollection.fromDocuments(docs, null, { depth: 0 })
}

function itemFor(collection: DomainCollection, absPath: string): CollectionItem<Document> {
  const item = collection.allItems.find((i) => i.path === absPath)
  if (!item) throw new Error(`fixture item missing: ${absPath}`)
  return item
}

// ---------------------------------------------------------------------------
// Topic terms
// ---------------------------------------------------------------------------

test('extractTopicTerms', () => {
  const terms = extractTopicTerms('What did we decide about the Atlas rollout in 2026?', [
    '{ meetings(where: { bodyContains: "milestones", dateGte: "2026-01-01" }) { path } }',
  ])

  assert({
    given: 'a question and a query with string literals',
    should: 'keep content words, years, and quoted literals; drop stopwords, field names, and short or numeric tokens',
    actual: terms,
    expected: ['decide', 'atlas', 'rollout', '2026', 'milestones'],
  })
})

// ---------------------------------------------------------------------------
// Provenance tiers and boost
// ---------------------------------------------------------------------------

test('tierForResultSize', () => {
  assert({
    given: 'result-set sizes around the tier thresholds',
    should: 'classify targeted at ≤25, medium at ≤150, broad above',
    actual: [
      tierForResultSize(1),
      tierForResultSize(25),
      tierForResultSize(26),
      tierForResultSize(150),
      tierForResultSize(151),
    ],
    expected: ['targeted', 'targeted', 'medium', 'medium', 'broad'],
  })
})

test('strongerTier', () => {
  assert({
    given: 'tier pairs',
    should: 'keep the stronger evidence',
    actual: [strongerTier('broad', 'medium'), strongerTier('targeted', 'broad'), strongerTier('medium', 'medium')],
    expected: ['medium', 'targeted', 'medium'],
  })
})

test('provenanceBoost', () => {
  const targeted: DocProvenance = { tier: 'targeted', hits: 1, lastHitTurn: 1 }
  const broadTwice: DocProvenance = { tier: 'broad', hits: 3, lastHitTurn: 2 }

  assert({
    given: 'no evidence, one targeted hit, and repeated broad hits',
    should: 'boost 0, the tier value, and the tier value plus the multi-hit bonus',
    actual: [provenanceBoost(undefined), provenanceBoost(targeted), provenanceBoost(broadTwice)],
    expected: [0, 10, 5],
  })
})

// ---------------------------------------------------------------------------
// The composed scorer
// ---------------------------------------------------------------------------

test('createChatScorer - no evidence degrades to the shared prior', async () => {
  const collection = await fixtureCollection([FIX.person, FIX.meeting, FIX.goal, FIX.day])
  const { scorer } = createChatScorer({ today: TODAY, collection, terms: [], provenance: new Map() })
  const base = createRecencyTypeScorer(TODAY)

  assert({
    given: 'no topic terms and no retrieval evidence',
    should: 'score every doc exactly like the shared recency+type scorer',
    actual: collection.allItems.map((i) => verdictScore(scorer(i))),
    expected: collection.allItems.map((i) => verdictScore(base(i))),
  })
})

test('createChatScorer - lexical lifts the doc the topic names', async () => {
  const collection = await fixtureCollection([FIX.person, FIX.digest, FIX.goal])
  const { scorer, lexicalByPath } = createChatScorer({
    today: TODAY,
    collection,
    terms: ['jane', 'doe'],
    provenance: new Map(),
  })
  const personScore = verdictScore(scorer(itemFor(collection, FIX.person)))
  const digestScore = verdictScore(scorer(itemFor(collection, FIX.digest)))

  assert({
    given: 'topic terms that fully cover a person card filename and appear once in a long same-day digest',
    should: 'rank the person card above the digest despite its recency edge — name coverage beats a passing mention',
    actual: {
      personAboveDigest: personScore > digestScore,
      personLexAtMax: lexicalByPath.get(FIX.person),
      digestLexPartial: (lexicalByPath.get(FIX.digest) ?? 0) > 0 && (lexicalByPath.get(FIX.digest) ?? 0) < 8,
    },
    expected: { personAboveDigest: true, personLexAtMax: 8, digestLexPartial: true },
  })
})

test('createChatScorer - short terms match whole words only', async () => {
  const collection = await fixtureCollection([FIX.person, FIX.digest])
  // "ent" hides inside "percent"/"documentation"-class words all over
  // the digest; as a whole word it matches nothing in either doc.
  const { scorer, lexicalByPath } = createChatScorer({
    today: TODAY,
    collection,
    terms: ['ent'],
    provenance: new Map(),
  })
  collection.allItems.forEach((i) => scorer(i))

  assert({
    given: 'a three-letter term that only occurs inside longer words',
    should: 'credit no document',
    actual: [lexicalByPath.get(FIX.person), lexicalByPath.get(FIX.digest)],
    expected: [0, 0],
  })
})

test('createChatScorer - header channels outrank body mentions', async () => {
  const collection = await fixtureCollection([FIX.deal, FIX.vendor, FIX.goal])
  // "nimbus" lives only in the deal message's rel and tags — its body and
  // filename never say it — while the vendor note mentions it once in a
  // long body. The authored linkage must win.
  const { scorer, lexicalByPath } = createChatScorer({
    today: TODAY,
    collection,
    terms: ['nimbus'],
    provenance: new Map(),
  })
  collection.allItems.forEach((i) => scorer(i))
  const dealLex = lexicalByPath.get(FIX.deal) ?? 0
  const vendorLex = lexicalByPath.get(FIX.vendor) ?? 0

  assert({
    given: "a term present only in one doc's rel/tags and once in another doc's long body",
    should: 'give the rel/tags doc full credit and the body mention a damped partial',
    actual: {
      dealLex,
      vendorPartial: vendorLex > 0 && vendorLex < dealLex / 2,
    },
    expected: { dealLex: 8, vendorPartial: true },
  })
})

test('createChatScorer - tags channel carries taxonomy terms', async () => {
  const collection = await fixtureCollection([FIX.deal, FIX.vendor, FIX.goal])
  // "acquisitions" appears only as a tag segment on the deal message.
  const { scorer, lexicalByPath } = createChatScorer({
    today: TODAY,
    collection,
    terms: ['acquisitions'],
    provenance: new Map(),
  })
  collection.allItems.forEach((i) => scorer(i))

  assert({
    given: "a term that exists only in one doc's tag taxonomy",
    should: 'credit that doc fully through the tags channel',
    actual: { dealLex: lexicalByPath.get(FIX.deal), vendorLex: lexicalByPath.get(FIX.vendor) },
    expected: { dealLex: 8, vendorLex: 0 },
  })
})

test('createChatScorer - targeted retrieval outranks the recency prior', async () => {
  const collection = await fixtureCollection([FIX.person, FIX.meeting])
  const provenance = new Map<string, DocProvenance>([[FIX.person, { tier: 'targeted', hits: 1, lastHitTurn: 1 }]])
  const { scorer } = createChatScorer({ today: TODAY, collection, terms: [], provenance })

  assert({
    given: 'an undated person card a targeted query returned, against a week-old meeting',
    should: 'add exactly the targeted boost and win',
    actual: {
      person: verdictScore(scorer(itemFor(collection, FIX.person))),
      personWins:
        verdictScore(scorer(itemFor(collection, FIX.person))) > verdictScore(scorer(itemFor(collection, FIX.meeting))),
    },
    expected: { person: 16, personWins: true },
  })
})
