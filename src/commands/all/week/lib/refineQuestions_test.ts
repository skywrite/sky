import { assert, test } from '#test'
import { parseRefineQuestions } from './refineQuestions.ts'

test('parseRefineQuestions - one per line, tolerant of stray list markers', () => {
  const parsed = parseRefineQuestions(
    'Is the restructure decision this week or next?\n' +
      '- Does the board update land before or after Thursday?\n' +
      '2. Keep the dashboard goal if the vendor date slips?\n',
  )

  assert({
    given: 'plain, bulleted, and numbered lines',
    should: 'strip markers and keep all three',
    actual: parsed.join(' | '),
    expected:
      'Is the restructure decision this week or next? | Does the board update land before or after Thursday? | Keep the dashboard goal if the vendor date slips?',
  })
})

test('parseRefineQuestions - empty output means no questions', () => {
  assert({
    given: 'whitespace-only model output',
    should: 'return no questions',
    actual: parseRefineQuestions('  \n \n').length,
    expected: 0,
  })
})

test('parseRefineQuestions - caps the count', () => {
  const parsed = parseRefineQuestions(['q1?', 'q2?', 'q3?', 'q4?', 'q5?', 'q6?', 'q7?', 'q8?'].join('\n'))

  assert({
    given: 'eight questions',
    should: 'keep only the first six',
    actual: `${parsed.length}: ${parsed[5]}`,
    expected: '6: q6?',
  })
})
