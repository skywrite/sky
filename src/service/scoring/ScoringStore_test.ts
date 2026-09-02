/**
 * Tests for standalone ScoringStore.
 */

import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { INTERACTION_WEIGHTS, ScoringStore } from './mod.ts'

const referenceDate = new PlainDate('2026-02-01')

test('ScoringStore - records person interaction with full weight for recent date', () => {
  const scoring = new ScoringStore()
  scoring.recordPersonInteraction('Alice', '2026-02-01', INTERACTION_WEIGHTS.meeting, referenceDate)

  const score = scoring.personScores.get('Alice')
  assert({
    given: 'a meeting interaction today',
    should: 'have full weight score (10)',
    actual: score?.score,
    expected: 10,
  })
  assert({
    given: 'a meeting interaction today',
    should: 'have 1 interaction count',
    actual: score?.interactionCount,
    expected: 1,
  })
  assert({
    given: 'a meeting interaction today',
    should: 'track the interaction date',
    actual: score?.lastInteraction,
    expected: '2026-02-01',
  })
})

test('ScoringStore - records org interaction with full weight for recent date', () => {
  const scoring = new ScoringStore()
  scoring.recordOrgInteraction('Acme Inc', '2026-02-01', INTERACTION_WEIGHTS.project, referenceDate)

  const score = scoring.orgScores.get('Acme Inc')
  assert({
    given: 'a project interaction today',
    should: 'have full weight score (10)',
    actual: score?.score,
    expected: 10,
  })
  assert({
    given: 'a project interaction today',
    should: 'have 1 interaction count',
    actual: score?.interactionCount,
    expected: 1,
  })
})

test('ScoringStore - compounds multiple interactions', () => {
  const scoring = new ScoringStore()

  // Two meetings in the same week
  scoring.recordPersonInteraction('Bob', '2026-02-01', INTERACTION_WEIGHTS.meeting, referenceDate)
  scoring.recordPersonInteraction('Bob', '2026-01-28', INTERACTION_WEIGHTS.meeting, referenceDate)

  const score = scoring.personScores.get('Bob')
  assert({
    given: 'two meetings in the same week',
    should: 'compound the scores (10 + 10)',
    actual: score?.score,
    expected: 20,
  })
  assert({
    given: 'two interactions',
    should: 'count both interactions',
    actual: score?.interactionCount,
    expected: 2,
  })
  assert({
    given: 'two interactions',
    should: 'track the most recent date',
    actual: score?.lastInteraction,
    expected: '2026-02-01',
  })
})

test('ScoringStore - applies recency decay to older interactions', () => {
  const scoring = new ScoringStore()

  // Meeting 15 days ago (month tier: 0.5x)
  scoring.recordPersonInteraction('Carol', '2026-01-17', INTERACTION_WEIGHTS.meeting, referenceDate)

  const score = scoring.personScores.get('Carol')
  assert({
    given: 'a meeting 15 days ago',
    should: 'apply 0.5x recency multiplier (10 × 0.5 = 5)',
    actual: score?.score,
    expected: 5,
  })
})

test('ScoringStore - getPeopleWithScores includes all people even without scores', () => {
  const scoring = new ScoringStore()
  scoring.recordPersonInteraction('Alice', '2026-02-01', INTERACTION_WEIGHTS.meeting, referenceDate)

  const allPeople = ['Alice', 'Bob', 'Carol']
  const scores = scoring.getPeopleWithScores(allPeople)

  assert({
    given: 'a list of 3 people with only 1 having interactions',
    should: 'return all 3 people',
    actual: scores.length,
    expected: 3,
  })
  assert({
    given: 'Alice has the highest score',
    should: 'sort Alice first',
    actual: scores[0].name,
    expected: 'Alice',
  })
  assert({
    given: 'Bob has no interactions',
    should: 'have zero score',
    actual: scores[1].score,
    expected: 0,
  })
})

test('ScoringStore - getOrgsWithScores sorts by score descending', () => {
  const scoring = new ScoringStore()
  scoring.recordOrgInteraction('Small Co', '2026-02-01', INTERACTION_WEIGHTS.day, referenceDate) // 2 points
  scoring.recordOrgInteraction('Big Corp', '2026-02-01', INTERACTION_WEIGHTS.meeting, referenceDate) // 10 points

  const allOrgs = ['Small Co', 'Big Corp']
  const scores = scoring.getOrgsWithScores(allOrgs)

  assert({
    given: 'Big Corp has higher score',
    should: 'sort Big Corp first',
    actual: scores[0].name,
    expected: 'Big Corp',
  })
  assert({
    given: 'Big Corp meeting interaction',
    should: 'have score of 10',
    actual: scores[0].score,
    expected: 10,
  })
  assert({
    given: 'Small Co day mention',
    should: 'have score of 2',
    actual: scores[1].score,
    expected: 2,
  })
})

test('ScoringStore - clear() removes all scores', () => {
  const scoring = new ScoringStore()
  scoring.recordPersonInteraction('Alice', '2026-02-01', INTERACTION_WEIGHTS.meeting, referenceDate)
  scoring.recordOrgInteraction('Acme', '2026-02-01', INTERACTION_WEIGHTS.project, referenceDate)

  assert({
    given: 'recorded person and org interactions',
    should: 'have 1 person score',
    actual: scoring.personScores.size,
    expected: 1,
  })
  assert({
    given: 'recorded person and org interactions',
    should: 'have 1 org score',
    actual: scoring.orgScores.size,
    expected: 1,
  })

  scoring.clear()

  assert({
    given: 'clear() called',
    should: 'have no person scores',
    actual: scoring.personScores.size,
    expected: 0,
  })
  assert({
    given: 'clear() called',
    should: 'have no org scores',
    actual: scoring.orgScores.size,
    expected: 0,
  })
})

// --- Tag scoring tests ---

test('ScoringStore - records tag interaction with recency multiplier', () => {
  const scoring = new ScoringStore()
  scoring.recordTagInteraction('project', '2026-02-01', referenceDate)

  const score = scoring.tagScores.get('project')
  assert({
    given: 'a tag used today',
    should: 'have full weight score (1.0)',
    actual: score?.score,
    expected: 1.0,
  })
  assert({
    given: 'a tag used today',
    should: 'have 1 file count',
    actual: score?.fileCount,
    expected: 1,
  })
  assert({
    given: 'a tag used today',
    should: 'track the last seen date',
    actual: score?.lastSeen,
    expected: '2026-02-01',
  })
})

test('ScoringStore - compounds tag usage across files', () => {
  const scoring = new ScoringStore()

  scoring.recordTagInteraction('daily', '2026-02-01', referenceDate)
  scoring.recordTagInteraction('daily', '2026-01-31', referenceDate)
  scoring.recordTagInteraction('daily', '2026-01-30', referenceDate)

  const score = scoring.tagScores.get('daily')
  assert({
    given: 'a tag used in 3 files this week',
    should: 'compound the scores (1.0 + 1.0 + 1.0)',
    actual: score?.score,
    expected: 3.0,
  })
  assert({
    given: '3 file appearances',
    should: 'count all files',
    actual: score?.fileCount,
    expected: 3,
  })
})

test('ScoringStore - applies recency decay to older tag usage', () => {
  const scoring = new ScoringStore()

  // Tag used 15 days ago (month tier: 0.5x)
  scoring.recordTagInteraction('old-tag', '2026-01-17', referenceDate)

  const score = scoring.tagScores.get('old-tag')
  assert({
    given: 'a tag used 15 days ago',
    should: 'apply 0.5x recency multiplier',
    actual: score?.score,
    expected: 0.5,
  })
})

test('ScoringStore - getTagsWithScores sorts by score descending', () => {
  const scoring = new ScoringStore()

  // 'rare' used once 15 days ago = 0.5
  scoring.recordTagInteraction('rare', '2026-01-17', referenceDate)
  // 'common' used 3 times this week = 3.0
  scoring.recordTagInteraction('common', '2026-02-01', referenceDate)
  scoring.recordTagInteraction('common', '2026-01-31', referenceDate)
  scoring.recordTagInteraction('common', '2026-01-30', referenceDate)

  const allTags = ['common', 'rare', 'unused']
  const scores = scoring.getTagsWithScores(allTags)

  assert({
    given: '3 tags (2 with scores, 1 without)',
    should: 'return all 3',
    actual: scores.length,
    expected: 3,
  })
  assert({
    given: 'common has highest score',
    should: 'sort common first',
    actual: scores[0].name,
    expected: 'common',
  })
  assert({
    given: 'rare has second highest score',
    should: 'sort rare second',
    actual: scores[1].name,
    expected: 'rare',
  })
  assert({
    given: 'unused has no score',
    should: 'have zero score',
    actual: scores[2].score,
    expected: 0,
  })
})

test('ScoringStore - clear removes tag scores', () => {
  const scoring = new ScoringStore()
  scoring.recordTagInteraction('test', '2026-02-01', referenceDate)

  assert({
    given: 'recorded tag interaction',
    should: 'have 1 tag score',
    actual: scoring.tagScores.size,
    expected: 1,
  })

  scoring.clear()

  assert({
    given: 'clear() called',
    should: 'have no tag scores',
    actual: scoring.tagScores.size,
    expected: 0,
  })
})

test('ScoringStore - can be used independently of Store', () => {
  // This test verifies ScoringStore is fully standalone
  const scoring = new ScoringStore()

  // Record some interactions
  scoring.recordPersonInteraction('Alice', '2026-02-01', 10, referenceDate)
  scoring.recordOrgInteraction('Acme', '2026-02-01', 10, referenceDate)

  // Get scores with arbitrary name lists (not from Store)
  const peopleScores = scoring.getPeopleWithScores(['Alice', 'Bob'])
  const orgScores = scoring.getOrgsWithScores(['Acme', 'Other'])

  assert({
    given: 'arbitrary people list',
    should: 'return scores for all',
    actual: peopleScores.length,
    expected: 2,
  })
  assert({
    given: 'arbitrary org list',
    should: 'return scores for all',
    actual: orgScores.length,
    expected: 2,
  })
})

test('ScoringStore - a person scores as one across spellings and case', () => {
  const scoring = new ScoringStore()
  scoring.recordPersonInteraction('Jane Doe', '2026-01-26', INTERACTION_WEIGHTS.meeting, referenceDate)
  scoring.recordPersonInteraction('jane doe', '2026-01-30', INTERACTION_WEIGHTS.email, referenceDate)
  scoring.recordPersonInteraction('Janie', '2026-02-01', INTERACTION_WEIGHTS.slack, referenceDate)
  scoring.recordPersonInteraction('Sam Park', '2026-02-01', INTERACTION_WEIGHTS.meeting, referenceDate)
  const spellingsOf = (name: string) => (['Jane Doe', 'Janie'].includes(name) ? ['Jane Doe', 'Janie'] : [name])

  const people = scoring.getPeopleWithScores(['Jane Doe', 'Janie', 'jane doe', 'Sam Park'], spellingsOf)
  assert({
    given: 'interactions under two casings and a nickname the profile lists, reported under three names',
    should: 'add them up under each of her names, keep the latest date, and report a casing once',
    actual: people.map((p) => [p.name, p.score, p.lastInteraction, p.interactionCount]),
    expected: [
      ['Jane Doe', 18, '2026-02-01', 3],
      ['Janie', 18, '2026-02-01', 3],
      ['Sam Park', 10, '2026-02-01', 1],
    ],
  })
  assert({
    given: 'no spellings given',
    should: 'still add up the casings of one name',
    actual: scoring.getPeopleWithScores(['Jane Doe']).map((p) => [p.name, p.score]),
    expected: [['Jane Doe', 15]],
  })
})

test('ScoringStore - a source read again counts once, and a forgotten source gives back its share', () => {
  const scoring = new ScoringStore()
  const read = (source: string, name: string, dateStr: string, weight: number) =>
    scoring.recordPersonInteraction(name, dateStr, weight, referenceDate, source)
  read('/nb/a.md', 'Jane Doe', '2026-01-30', INTERACTION_WEIGHTS.meeting)
  read('/nb/b.md', 'Jane Doe', '2026-02-01', INTERACTION_WEIGHTS.email)
  scoring.recordTagInteraction('atlas', '2026-02-01', referenceDate, '/nb/b.md')
  scoring.recordOrgInteraction('Atlas', '2026-02-01', INTERACTION_WEIGHTS.project, referenceDate, '/nb/b.md')

  scoring.forgetSource('/nb/a.md')
  read('/nb/a.md', 'Jane Doe', '2026-01-30', INTERACTION_WEIGHTS.meeting)
  const afterReread = scoring.personScores.get('Jane Doe')
  assert({
    given: 'a file forgotten and read again',
    should: 'leave the score and count as after the first read',
    actual: [afterReread?.score, afterReread?.interactionCount, afterReread?.lastInteraction],
    expected: [15, 2, '2026-02-01'],
  })

  const forgot = scoring.forgetSource('/nb/b.md')
  const afterForget = scoring.personScores.get('Jane Doe')
  assert({
    given: 'the file with the latest interaction forgotten',
    should: 'take back its share, find the last date among what remains, and drop what it alone carried',
    actual: [
      forgot,
      afterForget?.score,
      afterForget?.interactionCount,
      afterForget?.lastInteraction,
      scoring.tagScores.has('atlas'),
      scoring.orgScores.has('Atlas'),
      scoring.forgetSource('/nb/b.md'),
    ],
    expected: [true, 10, 1, '2026-01-30', false, false, false],
  })
})
