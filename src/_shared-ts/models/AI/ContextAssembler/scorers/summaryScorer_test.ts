import type { CollectionEntityType, CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import { Document as MarkdownDocument } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { verdictScore } from '../mod.ts'
import { createSummaryScorer } from './summaryScorer.ts'

const DAY_DIR = '/notebook/time/2026/01/12-18/01-15'

const doc = MarkdownDocument.fromMarkdown('# Fixture')

function item(path: string, type: CollectionEntityType, depth = 0): CollectionItem<Document> {
  return { doc, path, type, depth }
}

const score = (scorer: ReturnType<typeof createSummaryScorer>, i: CollectionItem<Document>) => verdictScore(scorer(i))

test('summaryScorer pins the day record', () => {
  const scorer = createSummaryScorer(DAY_DIR)

  assert({
    given: 'day.md and a journal file inside the day directory',
    should: 'keep both unconditionally',
    actual: [
      scorer(item(`${DAY_DIR}/day.md`, 'day')).keep,
      scorer(item(`${DAY_DIR}/journal/health.md`, 'journal')).keep,
    ].join(','),
    expected: 'always,always',
  })
})

test('summaryScorer orders in-day actions meetings > messages > notes > chats', () => {
  const scorer = createSummaryScorer(DAY_DIR)
  const meeting = score(scorer, item(`${DAY_DIR}/actions/meetings/Zoom_Jane-Doe_Atlas.md`, 'meeting'))
  const message = score(scorer, item(`${DAY_DIR}/actions/messages/06-45_slack_Jane_Atlas.md`, 'message'))
  const note = score(scorer, item(`${DAY_DIR}/actions/notes/Atlas-idea.md`, 'document'))
  const chat = score(scorer, item(`${DAY_DIR}/actions/ai-chats/09-12_Atlas-Planning.md`, 'chat'))

  assert({
    given: 'one of each in-day action type',
    should: 'score meetings above messages above notes above chats',
    actual: meeting > message && message > note && note > chat,
    expected: true,
  })
})

test('summaryScorer scores background below every in-day action', () => {
  const scorer = createSummaryScorer(DAY_DIR)
  const inDayChat = score(scorer, item(`${DAY_DIR}/actions/ai-chats/09-12_Atlas-Planning.md`, 'chat'))
  const chainMsg = score(scorer, item('/notebook/time/2026/01/12-18/01-14/actions/messages/slack_x.md', 'message'))
  const person = score(scorer, item('/notebook/people/2026/ja/Jane-Doe.md', 'person'))

  assert({
    given: 'the lowest in-day action, a prior-day chain message, and a person file',
    should: 'rank in-day above chain antecedents above people',
    actual: inDayChat > chainMsg && chainMsg > person,
    expected: true,
  })
})

test('summaryScorer scores the same type differently by zone', () => {
  const scorer = createSummaryScorer(DAY_DIR)

  assert({
    given: 'a message inside the day directory and one outside it',
    should: 'score the in-day message higher',
    actual:
      score(scorer, item(`${DAY_DIR}/actions/messages/06-45_slack_Jane_Atlas.md`, 'message')) >
      score(scorer, item('/notebook/time/2026/01/12-18/01-13/actions/messages/slack_y.md', 'message')),
    expected: true,
  })
})
