import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { rarityOf, relevanceOf, searchPhrases, sortByRelevance } from './relevance.ts'

const TODAY = PlainDate.fromString('2026-10-05')
const todayMs = TODAY.toDate().getTime()
const dayPath = (daysAgo: number, name: string) => {
  const d = TODAY.addDays(-daysAgo)
  return `/nb/time/2026/W40/${d.toString().slice(5)}/actions/messages/${name}`
}
const message = (summary: string, body: string) =>
  Document.fromMarkdown(`---\nfrom: Jane Doe\nto: Atlas Team\nsummary: ${summary}\n---\n${body}`)

test({ name: 'relevance - the search phrases are the text filters, lowercased, nothing else' }, () => {
  assert({
    given: 'a where with a body filter, a name filter, a person filter and a date',
    should: 'return the two text phrases only',
    actual: searchPhrases({ bodyContains: 'Atlas', nameContains: 'Jane', involves: 'Jane Doe', date: '2026-10-05' }),
    expected: ['atlas', 'jane'],
  })
})

test(
  { name: 'relevance - a header hit is full credit; a body mention is a quarter at most, less in a long document' },
  () => {
    const rarity = rarityOf(300, 30_000) // ≈ 0.447
    const header = message('Atlas rollout checklist', 'Status notes for the week.')
    const shortMention = message('Weekly sync', 'We touched on atlas briefly.')
    const longMention = message(
      'Weekly sync',
      `${'Other topics filled the hour. '.repeat(300)} We touched on atlas briefly.`,
    )
    const score = (doc: Document) => relevanceOf(doc, dayPath(1, 'x.md'), ['atlas'], rarity)
    assert({
      given: 'a 300-of-30,000 term in a title, once in a short message, and once in a long one',
      should: 'score the title at the rarity, the short mention at a quarter of it, the long one well under',
      actual: {
        rarity: Math.round(rarity * 1000) / 1000,
        header: Math.round(score(header) * 1000) / 1000,
        shortIsQuarter: Math.abs(score(shortMention) - rarity * 0.25) < 1e-9,
        longUnderTenth: score(longMention) < rarity * 0.1,
      },
      expected: { rarity: 0.447, header: 0.447, shortIsQuarter: true, longUnderTenth: true },
    })
  },
)

test({ name: 'sortByRelevance - a titled match comes forward a month; a passing mention keeps its date order' }, () => {
  const entries = [
    {
      doc: message(
        'Weekly sync',
        `${'Everything else going on this week, at length. '.repeat(200)} Mentioned atlas once.`,
      ),
      path: dayPath(1, 'sync.md'),
    },
    {
      doc: message('Deploy window', 'Atlas atlas atlas: the whole message is about the rollout. atlas.'),
      path: dayPath(3, 'deploy.md'),
    },
    { doc: message('Atlas rollout checklist', 'Steps for next week.'), path: dayPath(21, 'checklist.md') },
    { doc: message('Standup notes', 'Someone asked about atlas.'), path: dayPath(60, 'standup.md') },
  ]
  const byDate = entries.map((e) => e.path.split('/').pop())
  const ordered = sortByRelevance([...entries], { bodyContains: 'atlas' }, 30_000, todayMs).map((e) =>
    e.path.split('/').pop(),
  )
  assert({
    given:
      'four matches: one passing mention in a long update yesterday, a dense short one three days ago, a titled one three weeks ago, a passing one two months ago',
    should: 'put the titled match first, then the dense recent one, then the passing ones newest first',
    actual: { byDate, ordered },
    expected: {
      byDate: ['sync.md', 'deploy.md', 'checklist.md', 'standup.md'],
      ordered: ['checklist.md', 'deploy.md', 'sync.md', 'standup.md'],
    },
  })
})

test({ name: 'sortByRelevance - without a text filter it is plain newest-first' }, () => {
  const entries = [
    { doc: message('Older', 'atlas'), path: dayPath(5, 'old.md') },
    { doc: message('Newer', 'nothing'), path: dayPath(1, 'new.md') },
  ]
  assert({
    given: 'a where with no text filter',
    should: 'order by date, newest first',
    actual: sortByRelevance([...entries], { involves: 'Jane Doe' }, 100, todayMs).map((e) => e.path.split('/').pop()),
    expected: ['new.md', 'old.md'],
  })
})
