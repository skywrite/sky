import { assert, test } from '#test'
import AboutMe from './mod.ts'

const SAMPLE = `---
created: 2026-01-15
updated: 2026-01-15
---

# About Me - Jane Smith

## Personal

**Location:** Austin, TX

## Family

Married with two kids (8 and 5).

## Professional

**Company:** Acme Corp
**Title:** CTO
**About:** Cloud infrastructure platform for startups.

## Preferences

**Communication style:** Direct and concise.
**Decision-making:** Data-driven with gut checks.
**Technical context:** TypeScript, Go, AWS

## Bio

Jane Smith is the CTO of Acme Corp, a cloud infrastructure platform for startups. Based in Austin, TX.
`

test('AboutMe parses firstName and lastName from H1', () => {
  const doc = AboutMe.fromMarkdown(SAMPLE)
  assert({
    given: 'about-me with "About Me - Jane Smith"',
    should: 'parse firstName',
    actual: doc.firstName,
    expected: 'Jane',
  })
  assert({
    given: 'about-me with "About Me - Jane Smith"',
    should: 'parse lastName',
    actual: doc.lastName,
    expected: 'Smith',
  })
})

test('AboutMe.fullName combines first and last', () => {
  const doc = AboutMe.fromMarkdown(SAMPLE)
  assert({
    given: 'about-me with first and last name',
    should: 'return full name',
    actual: doc.fullName,
    expected: 'Jane Smith',
  })
})

test('AboutMe parses Personal section', () => {
  const doc = AboutMe.fromMarkdown(SAMPLE)
  assert({
    given: 'about-me with location',
    should: 'parse location',
    actual: doc.location,
    expected: 'Austin, TX',
  })
})

test('AboutMe parses Family section', () => {
  const doc = AboutMe.fromMarkdown(SAMPLE)
  assert({
    given: 'about-me with family text',
    should: 'parse family',
    actual: doc.family,
    expected: 'Married with two kids (8 and 5).',
  })
})

test('AboutMe parses Professional section', () => {
  const doc = AboutMe.fromMarkdown(SAMPLE)
  assert({
    given: 'about-me with company',
    should: 'parse company',
    actual: doc.company,
    expected: 'Acme Corp',
  })
  assert({
    given: 'about-me with title',
    should: 'parse title',
    actual: doc.title,
    expected: 'CTO',
  })
  assert({
    given: 'about-me with company description',
    should: 'parse companyDescription',
    actual: doc.companyDescription,
    expected: 'Cloud infrastructure platform for startups.',
  })
})

test('AboutMe parses Preferences section', () => {
  const doc = AboutMe.fromMarkdown(SAMPLE)
  assert({
    given: 'about-me with communication style',
    should: 'parse communicationStyle',
    actual: doc.communicationStyle,
    expected: 'Direct and concise.',
  })
  assert({
    given: 'about-me with decision-making',
    should: 'parse decisionMaking',
    actual: doc.decisionMaking,
    expected: 'Data-driven with gut checks.',
  })
  assert({
    given: 'about-me with technical context',
    should: 'parse technicalContext',
    actual: doc.technicalContext,
    expected: 'TypeScript, Go, AWS',
  })
})

test('AboutMe parses Bio section', () => {
  const doc = AboutMe.fromMarkdown(SAMPLE)
  assert({
    given: 'about-me with bio',
    should: 'parse bio',
    actual: doc.bio,
    expected: 'Jane Smith is the CTO of Acme Corp, a cloud infrastructure platform for startups. Based in Austin, TX.',
  })
})

test('AboutMe handles missing sections gracefully', () => {
  const minimal = `---
created: 2026-01-15
---

# About Me - Bob Jones

## Professional

**Company:** FooCorp
**Title:** Engineer
`
  const doc = AboutMe.fromMarkdown(minimal)
  assert({
    given: 'about-me with only Professional section',
    should: 'return empty string for missing fields',
    actual: doc.family,
    expected: '',
  })
  assert({
    given: 'about-me with only Professional section',
    should: 'still parse company',
    actual: doc.company,
    expected: 'FooCorp',
  })
})
