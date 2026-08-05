import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import StreakDocument from '#shared/models/Streak/mod.ts'
import { assert, test } from '#test'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'fixtures')

test(`StreakDocument.fromMarkdown() with fixture`, async () => {
  const given = 'Parse Streak from fixture file'

  const markdown = await readTextFile(path.join(DIR_FIXTURES, 'basic-streak.md'))
  const s = StreakDocument.fromMarkdown(markdown)

  assert({ given, should: 'restore name', expected: 'eat-clean', actual: s.name })
  assert({ given, should: 'restore title', expected: 'Eat clean', actual: s.title })
  assert({ given, should: 'restore schedule', expected: 'daily', actual: s.schedule })
  assert({ given, should: 'restore start', expected: '2026-01-05', actual: s.start?.ymd })
  assert({ given, should: 'leave end unset', expected: undefined, actual: s.end })
})

test(`StreakDocument.create()`, () => {
  const given = 'Create Streak w/ props'

  const s = StreakDocument.create({
    name: 'morning-run',
    title: 'Run before breakfast',
    schedule: 'weekdays',
    start: new PlainDate('2026-03-02'),
    why: 'Mornings are the only slot that survives the day.',
  })

  assert({ given, should: 'have correct name', expected: 'morning-run', actual: s.name })
  assert({ given, should: 'have correct title', expected: 'Run before breakfast', actual: s.title })
  assert({ given, should: 'have correct schedule', expected: 'weekdays', actual: s.schedule })
  assert({ given, should: 'have correct start', expected: '2026-03-02', actual: s.start?.ymd })
  assert({ given, should: 'stamp created', expected: true, actual: Boolean(s.yaml['created']) })
  assert({ given, should: 'stamp updated', expected: true, actual: Boolean(s.yaml['updated']) })

  const md = s.toMarkdown()
  assert({ given, should: 'render title as H1', expected: true, actual: md.includes('# Run before breakfast') })
  assert({ given, should: 'render the why body', expected: true, actual: md.includes('only slot that survives') })
})

test(`StreakDocument.create() defaults`, () => {
  const given = 'Create Streak with minimal props'

  const s = StreakDocument.create({ name: 'read' })

  assert({ given, should: 'default title to name', expected: 'read', actual: s.title })
  assert({ given, should: 'default schedule to daily', expected: 'daily', actual: s.schedule })
  assert({ given, should: 'default start to today', expected: PlainDate.today().ymd, actual: s.start?.ymd })
  assert({ given, should: 'have no end', expected: undefined, actual: s.end })
})

test(`StreakDocument yaml key order`, () => {
  const given = 'A streak parsed with keys out of display order'

  const s = StreakDocument.fromMarkdown(`---
tags: health
start: 2026-01-05
name: eat-clean
schedule: daily
title: Eat clean
---

# Eat clean
`)

  const keys = s
    .toMarkdown()
    .split('\n')
    .filter((l) => /^[a-z]+:/.test(l))
    .map((l) => l.split(':')[0])

  assert({
    given,
    should: 'reorder to the canonical display order',
    expected: ['name', 'title', 'schedule', 'start', 'tags'],
    actual: keys,
  })
})
