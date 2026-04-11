import { assert, test } from '#test'
import Person from './mod.ts'
import { PlainDate, PlainYearMonth } from '#universal/dates/nbdt/mod.ts'

test('Person.create - creates person with template', () => {
  const person = Person.create({
    name: 'John Doe',
    email: {
      personal: 'john@example.com',
      business: 'john@work.com',
    },
    met: '2025-10-12',
  })

  assert({
    given: 'person YAML data',
    should: 'create Person instance with name accessor',
    actual: person.name,
    expected: 'John Doe',
  })

  assert({
    given: 'person YAML data',
    should: 'create Person instance with met accessor',
    actual: person.met,
    expected: PlainDate.from('2025-10-12'),
  })

  assert({
    given: 'person YAML data',
    should: 'generate markdown template',
    actual: person.markdown.includes('# John Doe'),
    expected: true,
  })

  assert({
    given: 'person YAML data',
    should: 'include Background section',
    actual: person.markdown.includes('## Background'),
    expected: true,
  })
})

test('Person.fromMarkdown - loads person from markdown', () => {
  const markdown = `---
name: Jane Smith
email:
  personal: jane@example.com
  business: jane@work.com
title: CEO
org: Acme Corp
location: New York
met: "2025-01-15"
tags: Friend/Close
created: "2025-10-12"
updated: "2025-10-12"
---

# Jane Smith

## Overview

Great person to work with.

## Family / Relationships

## Background

## Info
`

  const person = Person.fromMarkdown(markdown)

  assert({
    given: 'markdown with YAML frontmatter',
    should: 'parse name',
    actual: person.name,
    expected: 'Jane Smith',
  })

  assert({
    given: 'markdown with YAML frontmatter',
    should: 'parse title',
    actual: person.title,
    expected: 'CEO',
  })

  assert({
    given: 'markdown with YAML frontmatter',
    should: 'parse org',
    actual: person.org,
    expected: 'Acme Corp',
  })

  assert({
    given: 'markdown with YAML frontmatter',
    should: 'parse location',
    actual: person.location,
    expected: 'New York',
  })

  assert({
    given: 'markdown with YAML frontmatter',
    should: 'parse met date',
    actual: person.met,
    expected: PlainDate.from('2025-01-15'),
  })

  assert({
    given: 'markdown with YAML frontmatter',
    should: 'parse tags',
    actual: person.tags.has('Friend/Close'),
    expected: true,
  })

  assert({
    given: 'markdown with YAML frontmatter',
    should: 'parse markdown content',
    actual: person.markdown.includes('Great person to work with'),
    expected: true,
  })
})

test('Person.toMarkdown - round trip', () => {
  const person = Person.create({
    name: 'Bob Johnson',
    email: {
      personal: 'bob@example.com',
    },
    title: 'Engineer',
    met: '2025-06-01',
    tags: 'Work/Colleague',
  })

  const markdown = person.toMarkdown()
  const loaded = Person.fromMarkdown(markdown)

  assert({
    given: 'person converted to markdown and back',
    should: 'preserve name',
    actual: loaded.name,
    expected: 'Bob Johnson',
  })

  assert({
    given: 'person converted to markdown and back',
    should: 'preserve title',
    actual: loaded.title,
    expected: 'Engineer',
  })

  assert({
    given: 'person converted to markdown and back',
    should: 'preserve tags',
    actual: loaded.tags.has('Work/Colleague'),
    expected: true,
  })
})

test('Person.met - supports PlainYearMonth when only year-month provided', () => {
  const person = Person.create({
    name: 'Year Month Person',
    met: '2024-06',
  })

  assert({
    given: 'person with met as YYYY-MM',
    should: 'return PlainYearMonth',
    actual: person.met,
    expected: PlainYearMonth.from('2024-06'),
  })

  assert({
    given: 'PlainYearMonth met',
    should: 'have correct year',
    actual: person.met?.year,
    expected: 2024,
  })
})

test('Person - inherits Document functionality', () => {
  const person = Person.create({
    name: 'Alice Cooper',
    met: '2025-03-15',
  })

  assert({
    given: 'newly created person',
    should: 'have created date set',
    actual: person.created !== undefined,
    expected: true,
  })

  assert({
    given: 'newly created person',
    should: 'have updated date set',
    actual: person.updated !== undefined,
    expected: true,
  })

  // Test tag functionality
  const withTags = person.updateTags(person.tags.add('Friend/Close'))

  assert({
    given: 'person with added tag',
    should: 'have the tag',
    actual: withTags.tags.has('Friend/Close'),
    expected: true,
  })
})
