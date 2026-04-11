import { assert, test } from '#test'
import { extractSlug, parsePromptFile } from './parse.ts'
import { compareSemver, parseSemver, PROMPT_SCHEMA_VERSION } from './types.ts'

test('extractSlug', () => {
  const given = 'a .prompt.md filename'
  const should = 'extract the slug without extension'

  const fixtures = [
    { input: 'journal-questions.prompt.md', expected: 'journal-questions' },
    { input: 'daily-reflection.prompt.md', expected: 'daily-reflection' },
    { input: 'simple.prompt.md', expected: 'simple' },
  ]

  for (const { input, expected } of fixtures) {
    const actual = extractSlug(input)
    assert({ actual, expected, given: `${given}: ${input}`, should })
  }
})

test('parseSemver', () => {
  const given = 'a semver string'
  const should = 'parse to tuple'

  const fixtures = [
    { input: '0.1.0', expected: [0, 1, 0] },
    { input: '1.0.0', expected: [1, 0, 0] },
    { input: '1.2.3', expected: [1, 2, 3] },
  ]

  for (const { input, expected } of fixtures) {
    const actual = parseSemver(input)
    assert({ actual, expected, given: `${given}: ${input}`, should })
  }
})

test('compareSemver', () => {
  const given = 'two semver strings'
  const should = 'compare correctly'

  const fixtures = [
    { a: '0.1.0', b: '0.1.0', expected: 0 },
    { a: '0.1.0', b: '0.2.0', expected: -1 },
    { a: '0.2.0', b: '0.1.0', expected: 1 },
    { a: '1.0.0', b: '0.9.9', expected: 1 },
    { a: '0.1.0', b: '1.0.0', expected: -1 },
    { a: '0.1.1', b: '0.1.0', expected: 1 },
  ]

  for (const { a, b, expected } of fixtures) {
    const actual = compareSemver(a, b)
    assert({ actual, expected, given: `${given}: ${a} vs ${b}`, should })
  }
})

test('parsePromptFile - valid file', () => {
  const given = 'a valid .prompt.md file'
  const should = 'parse frontmatter and body correctly'

  const content = `---
schema: 0.1.0
created: 2026-01-12
updated: 2026-01-12
description: Test prompt for unit testing
---

# Hello {{PROMPT_NAME}}

Today is {{DATE_NOTEBOOK_TODAY}}.`

  const result = parsePromptFile(content, 'test-prompt.prompt.md')

  assert({
    actual: result.slug,
    expected: 'test-prompt',
    given,
    should: 'extract slug correctly',
  })

  assert({
    actual: result.frontmatter.schema,
    expected: '0.1.0',
    given,
    should: 'parse schema version',
  })

  assert({
    actual: result.frontmatter.description,
    expected: 'Test prompt for unit testing',
    given,
    should: 'parse description',
  })

  assert({
    actual: result.frontmatter.created,
    expected: '2026-01-12',
    given,
    should: 'parse created date',
  })

  assert({
    actual: result.frontmatter.updated,
    expected: '2026-01-12',
    given,
    should: 'parse updated date',
  })

  assert({
    actual: result.body.includes('# Hello {{PROMPT_NAME}}'),
    expected: true,
    given,
    should: 'preserve template body',
  })
})

test('parsePromptFile - missing frontmatter', () => {
  const given = 'a file without frontmatter'

  const content = `# No Frontmatter

This file has no YAML frontmatter.`

  const result = parsePromptFile(content, 'no-frontmatter.prompt.md')

  assert({
    actual: result.frontmatter.schema,
    expected: PROMPT_SCHEMA_VERSION,
    given,
    should: 'default schema to current version',
  })

  assert({
    actual: result.body,
    expected: '# No Frontmatter\n\nThis file has no YAML frontmatter.',
    given,
    should: 'use entire content as body',
  })
})

test('parsePromptFile - missing optional fields', () => {
  const given = 'a file missing description, created, and updated'
  const should = 'parse successfully with defaults'

  const content = `---
schema: 0.1.0
---

# Minimal prompt file`

  const result = parsePromptFile(content, 'minimal.prompt.md')

  assert({
    actual: result.frontmatter.schema,
    expected: '0.1.0',
    given,
    should: 'parse schema version',
  })

  assert({
    actual: result.frontmatter.description,
    expected: '',
    given,
    should: 'default description to empty string',
  })

  assert({
    actual: result.frontmatter.created,
    expected: '',
    given,
    should: 'default created to empty string',
  })

  assert({
    actual: result.frontmatter.updated,
    expected: '',
    given,
    should: 'default updated to empty string',
  })
})

test('parsePromptFile - missing schema defaults to current version', () => {
  const given = 'a file with no schema field'

  const content = `---
description: No schema specified
---

Do the thing.`

  const result = parsePromptFile(content, 'no-schema.prompt.md')

  assert({
    actual: result.frontmatter.schema,
    expected: PROMPT_SCHEMA_VERSION,
    given,
    should: 'default to current schema version',
  })

  assert({
    actual: result.body,
    expected: 'Do the thing.',
    given,
    should: 'preserve body',
  })
})

test('parsePromptFile - only description provided', () => {
  const given = 'a file with only description'

  const content = `---
description: Just a description
---

Extract the conversation.`

  const result = parsePromptFile(content, 'desc-only.prompt.md')

  assert({
    actual: result.frontmatter.description,
    expected: 'Just a description',
    given,
    should: 'parse description',
  })

  assert({
    actual: result.frontmatter.created,
    expected: '',
    given,
    should: 'default created to empty string',
  })

  assert({
    actual: result.frontmatter.updated,
    expected: '',
    given,
    should: 'default updated to empty string',
  })
})

test('parsePromptFile - non-string field values are treated as missing', () => {
  const given = 'a file with non-string field values'

  const content = `---
schema: 0.2.0
created: 2026-01-12
updated: true
description: 42
---

Body here.`

  const result = parsePromptFile(content, 'bad-types.prompt.md')

  assert({
    actual: result.frontmatter.schema,
    expected: '0.2.0',
    given,
    should: 'parse valid schema',
  })

  assert({
    actual: result.frontmatter.created,
    expected: '2026-01-12',
    given,
    should: 'parse valid created',
  })

  assert({
    actual: result.frontmatter.updated,
    expected: '',
    given,
    should: 'default non-string updated to empty string',
  })

  assert({
    actual: result.frontmatter.description,
    expected: '',
    given,
    should: 'default non-string description to empty string',
  })
})

test('parsePromptFile - empty frontmatter', () => {
  const given = 'a file with empty frontmatter block'

  const content = `---
---

Just a prompt with no metadata.`

  const result = parsePromptFile(content, 'empty-fm.prompt.md')

  assert({
    actual: result.frontmatter.schema,
    expected: PROMPT_SCHEMA_VERSION,
    given,
    should: 'default schema to current version',
  })

  assert({
    actual: result.frontmatter.description,
    expected: '',
    given,
    should: 'default description to empty string',
  })

  assert({
    actual: result.body,
    expected: 'Just a prompt with no metadata.',
    given,
    should: 'preserve body',
  })
})

test('parsePromptFile - unsupported version', () => {
  const given = 'a file with future schema version'
  const should = 'warn but still parse successfully'

  const content = `---
schema: 99.0.0
created: 2026-01-12
updated: 2026-01-12
description: Future prompt
---

# From the future`

  const result = parsePromptFile(content, 'future.prompt.md')

  assert({
    actual: result.frontmatter.schema,
    expected: '99.0.0',
    given,
    should: 'preserve the schema version',
  })

  assert({
    actual: result.slug,
    expected: 'future',
    given,
    should,
  })
})
