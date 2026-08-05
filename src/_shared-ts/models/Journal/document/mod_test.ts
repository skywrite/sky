import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { Question } from '../type.d.ts'
import JournalDocument from './mod.ts'
import type { JournalQuestion } from './mod.ts'

const FIXTURES_DIR = path.join(import.meta.dirname!, 'fixtures')

async function readFixture(name: string): Promise<string> {
  return await readTextFile(path.join(FIXTURES_DIR, name))
}

// --- journalType ---

const typeFixtures = [
  {
    file: 'health-with-subquestions.md',
    description: 'Health type',
    expected: 'Health',
  },
  {
    file: 'lessons-learned-with-ai.md',
    description: 'Lessons Learned type',
    expected: 'Lessons Learned',
  },
  {
    file: 'self-improvement.md',
    description: 'Self Improvement type',
    expected: 'Self Improvement',
  },
]

typeFixtures.forEach((fixture) => {
  test(`JournalDocument.journalType - ${fixture.description}`, async () => {
    const doc = JournalDocument.fromMarkdown(await readFixture(fixture.file))
    assert({
      given: fixture.description,
      should: `return ${fixture.expected}`,
      actual: doc.journalType,
      expected: fixture.expected,
    })
  })
})

// --- date and time ---

interface DateTimeFixture {
  file: string
  description: string
  expectedDate: string
  expectedTime: string
}

const dateTimeFixtures: DateTimeFixture[] = [
  {
    file: 'health-with-subquestions.md',
    description: 'Health journal',
    expectedDate: '2026-01-05',
    expectedTime: '05:14',
  },
  {
    file: 'lessons-learned-with-ai.md',
    description: 'Lessons Learned journal',
    expectedDate: '2026-02-09',
    expectedTime: '06:30',
  },
  {
    file: 'self-improvement.md',
    description: 'Self Improvement journal',
    expectedDate: '2026-03-01',
    expectedTime: '08:15',
  },
]

dateTimeFixtures.forEach((fixture) => {
  test(`JournalDocument.date - ${fixture.description}`, async () => {
    const doc = JournalDocument.fromMarkdown(await readFixture(fixture.file))
    assert({
      given: fixture.description,
      should: `return date ${fixture.expectedDate}`,
      actual: doc.date,
      expected: fixture.expectedDate,
    })
  })

  test(`JournalDocument.time - ${fixture.description}`, async () => {
    const doc = JournalDocument.fromMarkdown(await readFixture(fixture.file))
    assert({
      given: fixture.description,
      should: `return time ${fixture.expectedTime}`,
      actual: doc.time,
      expected: fixture.expectedTime,
    })
  })
})

// --- questions ---

interface QuestionFixture {
  file: string
  description: string
  expected: JournalQuestion[]
}

const questionFixtures: QuestionFixture[] = [
  {
    file: 'health-with-subquestions.md',
    description: 'questions with sub-questions',
    expected: [
      {
        question: 'How are you feeling?',
        answer: 'Pretty good today.',
        subQuestions: [
          { question: 'Physical health?', answer: 'Slept well.', subQuestions: [] },
          { question: 'Mental health?', answer: 'Feeling focused.', subQuestions: [] },
        ],
      },
      {
        question: 'What did you eat yesterday?',
        answer: 'Healthy meals.',
        subQuestions: [],
      },
    ],
  },
  {
    file: 'lessons-learned-with-ai.md',
    description: 'multiple questions with (AI) prefix',
    expected: [
      {
        question: 'What did you learn today?',
        answer: 'Patience is key.',
        subQuestions: [],
      },
      {
        question: '(AI) What patterns are emerging?',
        answer: 'I notice a trend.',
        subQuestions: [],
      },
    ],
  },
  {
    file: 'health-empty-answer.md',
    description: 'empty answer',
    expected: [
      {
        question: 'How are you feeling?',
        answer: '',
        subQuestions: [],
      },
      {
        question: 'What did you eat yesterday?',
        answer: 'Some food.',
        subQuestions: [],
      },
    ],
  },
  {
    file: 'self-improvement.md',
    description: 'single question',
    expected: [
      {
        question: 'What habit are you building?',
        answer: 'Reading daily.',
        subQuestions: [],
      },
    ],
  },
]

questionFixtures.forEach((fixture) => {
  test(`JournalDocument.questions - ${fixture.description}`, async () => {
    const doc = JournalDocument.fromMarkdown(await readFixture(fixture.file))
    assert({
      given: fixture.description,
      should: 'parse questions correctly',
      actual: doc.questions,
      expected: fixture.expected,
    })
  })
})

// --- create() roundtrip ---

test('JournalDocument.create - roundtrip matches fixture', async () => {
  const questions: Question[] = [
    ['EVERY-DAY', 1.0, '(AI) How is your energy today?'],
    [
      'EVERY-DAY',
      1.0,
      'How are you feeling?',
      [
        ['EVERY-DAY', 1.0, 'Physical health?'],
        ['EVERY-DAY', 1.0, 'Mental health?'],
      ],
    ],
    ['EVERY-DAY', 1.0, 'What did you eat yesterday?'],
  ]

  const doc = JournalDocument.create({
    type: 'Health',
    date: new PlainDateTime({ date: '2026-01-05', time: '05:14' }),
    questions,
  })

  const expected = await readFixture('create-health-roundtrip.md')
  assert({
    given: 'created Health journal',
    should: 'produce markdown matching fixture',
    actual: doc.toMarkdown(),
    expected,
  })
})

test('JournalDocument.create - re-parse preserves getters', () => {
  const questions: Question[] = [
    ['EVERY-DAY', 1.0, '(AI) How is your energy today?'],
    ['EVERY-DAY', 1.0, 'How are you feeling?'],
  ]

  const doc = JournalDocument.create({
    type: 'Lessons Learned',
    date: new PlainDateTime({ date: '2026-02-09', time: '06:30' }),
    questions,
  })

  const reparsed = JournalDocument.fromMarkdown(doc.toMarkdown())

  assert({
    given: 're-parsed created document',
    should: 'return correct journalType',
    actual: reparsed.journalType,
    expected: 'Lessons Learned',
  })

  assert({
    given: 're-parsed created document',
    should: 'return correct date',
    actual: reparsed.date,
    expected: '2026-02-09',
  })

  assert({
    given: 're-parsed created document',
    should: 'return correct time',
    actual: reparsed.time,
    expected: '06:30',
  })

  assert({
    given: 're-parsed created document',
    should: 'return correct number of questions',
    actual: reparsed.questions.length,
    expected: 2,
  })
})
