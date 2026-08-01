import { assert, test } from '#test'
import { renderHomePage } from './mod.ts'
import type { HomePageData } from './mod.ts'

const FULL_DATA: HomePageData = {
  today: {
    dateLabel: 'Wednesday, March 4, 2026',
    ymd: '2026-03-04',
    dayRelativePath: 'time/2026/03/02-08/03-04/day.md',
    mostImportant: [{ label: 'Ship the Atlas report', relativePath: 'time/2026/03/02-08/03-04/most-important/MI1.md' }],
    streaks: [
      { title: 'Morning pages', doneToday: true },
      { title: 'Daily walk', doneToday: false },
    ],
  },
  recents: [
    {
      relativePath: 'time/2026/03/02-08/03-03/meeting_Jane-Doe_Atlas Sync.md',
      title: 'Atlas Sync',
      date: '2026-03-03',
    },
  ],
  counts: { documents: 12345, people: 42, orgs: 7, projects: 3 },
  searchEnabled: true,
}

const EMPTY_DATA: HomePageData = {
  today: null,
  recents: [],
  counts: null,
  searchEnabled: false,
}

test({ name: 'home page - renders today, recents, and counts' }, () => {
  const html = renderHomePage(FULL_DATA)

  assert({
    given: 'full home data',
    should: 'start with a doctype',
    actual: html.startsWith('<!DOCTYPE html>'),
    expected: true,
  })

  for (const expected of [
    'Wednesday, March 4, 2026',
    'Ship the Atlas report',
    'Morning pages',
    'Atlas Sync',
    '12,345 documents',
    'id="home-search"',
  ]) {
    assert({
      given: 'full home data',
      should: `render ${expected}`,
      actual: html.includes(expected),
      expected: true,
    })
  }

  assert({
    given: 'a day file that exists',
    should: 'link to it with encoded path segments',
    actual: html.includes('href="/docs/time/2026/03/02-08/03-04/day.md"'),
    expected: true,
  })

  assert({
    given: 'a recent doc with a space in its filename',
    should: 'encode the space in the link',
    actual: html.includes('meeting_Jane-Doe_Atlas%20Sync.md'),
    expected: true,
  })

  assert({
    given: 'an enabled search index',
    should: 'not show the warming-up hint',
    actual: html.includes('warming up'),
    expected: false,
  })
})

test({ name: 'home page - degrades gracefully without store or day data' }, () => {
  const html = renderHomePage(EMPTY_DATA)

  for (const expected of ['Day tracking is unavailable', 'Nothing indexed yet', 'warming up', 'disabled']) {
    assert({
      given: 'empty home data',
      should: `render ${expected}`,
      actual: html.includes(expected),
      expected: true,
    })
  }
})

test({ name: 'home page - escapes untrusted text' }, () => {
  const html = renderHomePage({
    ...EMPTY_DATA,
    recents: [{ relativePath: 'notes/x.md', title: '<script>alert(1)</script>', date: '2026-01-01' }],
  })

  assert({
    given: 'a document title containing markup',
    should: 'escape it',
    actual: html.includes('<script>alert(1)</script>'),
    expected: false,
  })
})
