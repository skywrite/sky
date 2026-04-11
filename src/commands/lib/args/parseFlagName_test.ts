import { assert, test } from '#test'
import parseFlagName, { stripValuePlaceholder } from './parseFlagName.ts'

const fixtures = [
  {
    flag: '-w, --when',
    expected: ['when', 'w'],
    description: 'both short and long flag name',
  },
  {
    flag: '--when',
    expected: ['when'],
    description: 'just long flag name',
  },
  {
    flag: '--max-tokens',
    expected: ['max-tokens'],
    description: 'kebab-case long flag name',
  },
  {
    flag: '-m, --max-tokens',
    expected: ['max-tokens', 'm'],
    description: 'both short and kebab-case long flag name',
  },
  // Value placeholder stripping tests
  {
    flag: '-d, --days <n>',
    expected: ['days', 'd'],
    description: 'both short and long flag with value placeholder',
  },
  {
    flag: '--max-tokens <value>',
    expected: ['max-tokens'],
    description: 'long flag with named value placeholder',
  },
  {
    flag: '-m, --model <name>',
    expected: ['model', 'm'],
    description: 'both short and long with named placeholder',
  },
  // Optional value placeholder tests
  {
    flag: '--file [path]',
    expected: ['file'],
    description: 'long flag with optional value placeholder',
  },
  {
    flag: '-f, --file [path]',
    expected: ['file', 'f'],
    description: 'both short and long with optional placeholder',
  },
]

fixtures.forEach((fixture) => {
  test(`parseFlagName - ${fixture.description}`, () => {
    const actual = parseFlagName(fixture.flag)

    assert({
      given: fixture.description,
      should: `return ${JSON.stringify(fixture.expected)}`,
      actual,
      expected: fixture.expected,
    })
  })
})

// stripValuePlaceholder tests
const stripFixtures = [
  { input: '--from <date>', expected: '--from', description: 'required placeholder' },
  { input: '-n, --limit <n>', expected: '-n, --limit', description: 'short and long with placeholder' },
  { input: '--file [path]', expected: '--file', description: 'optional placeholder' },
  { input: '-f, --file [path]', expected: '-f, --file', description: 'short and long with optional' },
  { input: '--flag', expected: '--flag', description: 'no placeholder' },
  { input: '-f, --flag', expected: '-f, --flag', description: 'short and long, no placeholder' },
]

stripFixtures.forEach((fixture) => {
  test(`stripValuePlaceholder - ${fixture.description}`, () => {
    const actual = stripValuePlaceholder(fixture.input)

    assert({
      given: fixture.description,
      should: `return "${fixture.expected}"`,
      actual,
      expected: fixture.expected,
    })
  })
})
