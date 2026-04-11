import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import parseQuestionsFromMarkdown from './parseQuestionsMarkdown.ts'
import type { Question } from './type.d.ts'

const FIXTURES_DIR = path.join(import.meta.dirname!, 'fixtures')

async function readFixture(name: string): Promise<string> {
  return await readTextFile(path.join(FIXTURES_DIR, name))
}

interface Fixture {
  file: string
  description: string
  expected: Question[]
}

// Basic parsing fixtures
const basicFixtures: Fixture[] = [
  {
    file: 'basic-simple.md',
    description: 'simple question with EVERY-DAY pattern',
    expected: [['EVERY-DAY', 1.0, 'How are you feeling?']],
  },
  {
    file: 'basic-multiple-questions.md',
    description: 'multiple questions under same pattern',
    expected: [
      ['EVERY-DAY', 1.0, 'Question one'],
      ['EVERY-DAY', 0.5, 'Question two'],
      ['EVERY-DAY', 0.1, 'Question three'],
    ],
  },
  {
    file: 'basic-multiple-patterns.md',
    description: 'multiple patterns',
    expected: [
      ['EVERY-DAY', 1.0, 'Daily question'],
      ['EVERY-MON', 1.0, 'Monday question'],
      ['MONTHLY-1', 1.0, 'First of month question'],
    ],
  },
  {
    file: 'basic-zero-probability.md',
    description: 'question with zero probability',
    expected: [['EVERY-DAY', 0.0, 'Never shown question']],
  },
  {
    file: 'basic-empty.md',
    description: 'empty file with only frontmatter',
    expected: [],
  },
  {
    file: 'basic-no-frontmatter.md',
    description: 'no frontmatter',
    expected: [['EVERY-DAY', 1.0, 'Question without frontmatter']],
  },
]

basicFixtures.forEach((fixture) => {
  test(`parseQuestionsFromMarkdown - ${fixture.description}`, async () => {
    const input = await readFixture(fixture.file)
    const actual = parseQuestionsFromMarkdown(input)

    assert({
      given: fixture.description,
      should: 'parse questions correctly',
      actual,
      expected: fixture.expected,
    })
  })
})

// Sub-questions fixtures
const subQuestionFixtures: Fixture[] = [
  {
    file: 'sub-single-level.md',
    description: 'single level of sub-questions',
    expected: [
      [
        'EVERY-DAY',
        1.0,
        'Have you reviewed your priorities?',
        [
          ['EVERY-DAY', 1.0, 'Do any changes need to be made?'],
          ['EVERY-DAY', 1.0, 'If yes, state what should be removed.'],
        ],
      ],
    ],
  },
  {
    file: 'sub-mixed.md',
    description: 'mixed questions with and without sub-questions',
    expected: [
      ['EVERY-DAY', 1.0, 'Simple question'],
      ['EVERY-DAY', 1.0, 'Question with sub', [['EVERY-DAY', 1.0, 'Sub question one']]],
      ['EVERY-DAY', 0.5, 'Another simple question'],
    ],
  },
  {
    file: 'sub-different-probability.md',
    description: 'sub-question with different probability',
    expected: [['EVERY-DAY', 0.1, 'Rare parent question', [['EVERY-DAY', 1.0, 'Always shown if parent shows']]]],
  },
]

subQuestionFixtures.forEach((fixture) => {
  test(`parseQuestionsFromMarkdown (sub-questions) - ${fixture.description}`, async () => {
    const input = await readFixture(fixture.file)
    const actual = parseQuestionsFromMarkdown(input)

    assert({
      given: fixture.description,
      should: 'parse sub-questions correctly',
      actual,
      expected: fixture.expected,
    })
  })
})

// Edge cases fixtures
const edgeCaseFixtures: Fixture[] = [
  {
    file: 'edge-colon-in-text.md',
    description: 'question with colon in text',
    expected: [['EVERY-DAY', 1.0, 'What time is it: morning or evening?']],
  },
  {
    file: 'edge-special-chars.md',
    description: 'question with special characters',
    expected: [['EVERY-DAY', 1.0, 'How\'s your "health" & well-being?']],
  },
  {
    file: 'edge-monthly-15.md',
    description: 'pattern with numbers',
    expected: [['MONTHLY-15', 1.0, 'Mid-month check-in']],
  },
  {
    file: 'edge-quarterly-1.md',
    description: 'pattern QUARTERLY-1',
    expected: [['QUARTERLY-1', 1.0, 'Quarterly review']],
  },
  {
    file: 'edge-every-other-day.md',
    description: 'pattern EVERY-OTHER-DAY-A',
    expected: [['EVERY-OTHER-DAY-A', 1.0, 'Alternating day question']],
  },
  {
    file: 'edge-blank-lines.md',
    description: 'blank lines between questions',
    expected: [
      ['EVERY-DAY', 1.0, 'First question'],
      ['EVERY-DAY', 1.0, 'Second question after blank line'],
    ],
  },
  {
    file: 'edge-trailing-whitespace.md',
    description: 'trailing whitespace in question',
    expected: [['EVERY-DAY', 1.0, 'Question with trailing space']],
  },
  {
    file: 'edge-integer-probability.md',
    description: 'integer probability (no decimal)',
    expected: [['EVERY-DAY', 1, 'Question with integer probability']],
  },
]

edgeCaseFixtures.forEach((fixture) => {
  test(`parseQuestionsFromMarkdown (edge cases) - ${fixture.description}`, async () => {
    const input = await readFixture(fixture.file)
    const actual = parseQuestionsFromMarkdown(input)

    assert({
      given: fixture.description,
      should: 'handle edge case correctly',
      actual,
      expected: fixture.expected,
    })
  })
})

// Real-world fixtures (based on actual question files)
const realWorldFixtures: Fixture[] = [
  {
    file: 'real-health.md',
    description: 'Health.md format',
    expected: [
      ['EVERY-DAY', 1.0, 'How are you feeling about your health?'],
      ['EVERY-DAY', 1.0, 'Describe your vision of you being in the best health.'],
      [
        'EVERY-DAY',
        1.0,
        "What's one action you can do today to bring your health closer to this vision? Put this action in the daily backlog.",
      ],
    ],
  },
  {
    file: 'real-execution.md',
    description: 'Execution.md format with sub-questions',
    expected: [
      [
        'EVERY-DAY',
        1.0,
        'Have you reviewed your priorities today?',
        [
          ['EVERY-DAY', 1.0, 'Do any changes need to be made to your priorities?'],
          ['EVERY-DAY', 1.0, 'If yes, state what should be removed.'],
          ['EVERY-DAY', 1.0, 'If yes, state what should be added.'],
          ['EVERY-DAY', 1.0, 'Any additional comments about the changes above?'],
          ['EVERY-DAY', 1.0, 'Paste the entire snapshot of the priorities.'],
        ],
      ],
    ],
  },
  {
    file: 'real-leadership.md',
    description: 'Leadership.md format with varying probabilities',
    expected: [
      ['EVERY-DAY', 0.1, 'Describe a recent time where you could have or did communicate "the why".'],
      ['EVERY-DAY', 0.1, 'Describe a recent time where you could have or did set clear expectations.'],
      [
        'EVERY-DAY',
        0.1,
        'Have you ensured your direct reports have all the resources they need to be successful recently?',
      ],
      [
        'EVERY-DAY',
        0.1,
        'Does anyone on your team need feedback? If so, when can you deliver this feedback? Commit to a date/time.',
      ],
      [
        'EVERY-DAY',
        0.2,
        'Describe a time where you let mediocrity slip or did not let it slip? If you did, what can you take action on? Commit to a date/time.',
      ],
    ],
  },
]

realWorldFixtures.forEach((fixture) => {
  test(`parseQuestionsFromMarkdown (real-world) - ${fixture.description}`, async () => {
    const input = await readFixture(fixture.file)
    const actual = parseQuestionsFromMarkdown(input)

    assert({
      given: fixture.description,
      should: 'parse real-world format correctly',
      actual,
      expected: fixture.expected,
    })
  })
})
