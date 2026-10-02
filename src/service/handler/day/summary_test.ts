import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { buildDayView, createDayRoutes } from './mod.ts'
import { parseDaySummary, type DaySummary } from './summary.ts'

const DAY = new PlainDate('2025-04-07')
const SUMMARY_PATH = `time/${dayDir(DAY)}/summary.md`
const SUMMARY = `---
title: Daily Summary
generated: private metadata
---

# Daily Summary

## Day at a Glance

### Atlas found its first customer

**Location:** Paris, France

You agreed the pilot with **Jane Doe**. [meeting 09:00](<actions/meetings/09-00_Atlas Planning.md>)

The signed proposal arrived in the evening. [email 18:00][proposal]

---

## Meaningful Moments

### A pilot with room to learn

**When:** 09:00

You chose a small first release. [meeting 09:00](<actions/meetings/09-00_Atlas Planning.md>)

### The proposal came back signed

You can begin on Friday. [email 18:00][proposal]

---

## Done

- Prepared the pilot checklist.

[proposal]: <actions/messages/18-00_Signed proposal (final).md>

<!-- SUMMARY-CONTEXT
private context inventory
-->
`

test('saved summaries present their opening and moments with working source links', () => {
  const summary = parseDaySummary(SUMMARY, SUMMARY_PATH, 42)
  const root = `/explorer/time/${dayDir(DAY)}`
  assert({
    given: 'a saved summary with metadata, two paragraphs, citations, and reference-style links',
    should: 'keep the authored story and move only citation links into source lists',
    actual: {
      headline: summary.headline,
      location: summary.location,
      html: summary.opening.html,
      sources: summary.opening.sources,
      moments: summary.moments.map(({ title, when }) => ({ title, when })),
      fallback: summary.documentHtml,
      version: summary.version,
    },
    expected: {
      headline: 'Atlas found its first customer',
      location: 'Paris, France',
      html: '<p>You agreed the pilot with <strong>Jane Doe</strong>.</p>\n<p>The signed proposal arrived in the evening.</p>',
      sources: [
        { label: 'meeting 09:00', href: `${root}/actions/meetings/09-00_Atlas%20Planning.md` },
        { label: 'email 18:00', href: `${root}/actions/messages/18-00_Signed%20proposal%20(final).md` },
      ],
      moments: [
        { title: 'A pilot with room to learn', when: '09:00' },
        { title: 'The proposal came back signed', when: null },
      ],
      fallback: null,
      version: 42,
    },
  })
  assert({
    given: 'the complete record and generation metadata below the opening',
    should: 'leave those details in the linked file rather than repeat them in the story',
    actual: JSON.stringify(summary).includes('private') || summary.opening.html.includes('checklist'),
    expected: false,
  })
})

test('older and custom summaries remain readable without inventing moments', () => {
  const legacy = parseDaySummary(
    '## Day at a Glance\n\nA quiet afternoon reading.\n\n## Done\n\n- Read a book.',
    SUMMARY_PATH,
  )
  const custom = parseDaySummary(
    '---\ntitle: Notes\n---\n\n# A day away\n\nSpent the afternoon at the gallery.\n\n```md\n## Day at a Glance\n```\n\n<!-- hidden -->',
    SUMMARY_PATH,
  )
  assert({
    given: 'an older one-sentence summary',
    should: 'show its exact opening without manufacturing a headline or moments',
    actual: { headline: legacy.headline, html: legacy.opening.html, moments: legacy.moments },
    expected: { headline: null, html: '<p>A quiet afternoon reading.</p>', moments: [] },
  })
  assert({
    given: 'a custom summary with an apparent section heading inside a code fence',
    should: 'render its document body, excluding frontmatter and machine comments',
    actual: {
      document: custom.documentHtml?.includes('Spent the afternoon at the gallery.'),
      metadata: custom.documentHtml?.includes('title: Notes'),
      comment: custom.documentHtml?.includes('hidden'),
      moments: custom.moments,
      empty: parseDaySummary('', SUMMARY_PATH).documentHtml,
    },
    expected: { document: true, metadata: false, comment: false, moments: [], empty: '' },
  })
})

test('summary prose preserves ordinary links and treats saved HTML and unsafe links as inert text', () => {
  const summary = parseDaySummary(
    `## Day at a Glance

### Research & **decisions**

Read [the plan](<actions/notes/Plan%20A.md#decision>) and [the reference](https://example.com/guide).

[unsafe](javascript:alert%281%29) [outside](../../../../../private.md)

<img src=x onerror="alert(1)">

![a diagram](https://example.com/pixel.png)

## Meaningful Moments

### A late decision

**When:** 25:30

The plan is ready. [notes](<actions/notes/Plan A.md>) [notes](<actions/notes/Plan A.md>)`,
    SUMMARY_PATH,
  )
  assert({
    given: 'ordinary links, raw HTML, an image, unsafe URLs, and a late-night moment',
    should: 'preserve readable formatting and real times while resolving only safe links',
    actual: {
      headline: summary.headline,
      local: summary.opening.html.includes(`/explorer/time/${dayDir(DAY)}/actions/notes/Plan%20A.md#decision`),
      external: summary.opening.html.includes('href="https://example.com/guide"'),
      executable: /<img|href="javascript:|href=".*private\.md/.test(summary.opening.html),
      escapedHtml: summary.opening.html.includes('&lt;img'),
      embeddedImage: summary.opening.html.includes('<img'),
      time: summary.moments[0].when,
      sources: summary.moments[0].sources.length,
    },
    expected: {
      headline: 'Research & decisions',
      local: true,
      external: true,
      executable: false,
      escapedHtml: true,
      embeddedImage: false,
      time: '25:30',
      sources: 1,
    },
  })
})

test('a day reads and refreshes its saved summary even without a day file, without writing to the notebook', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sky-day-summary-'))
  const options = { markdownBaseDir: root, timeDir: path.join(root, 'time'), today: () => DAY }
  const file = path.join(root, SUMMARY_PATH)
  try {
    assert({
      given: 'a day with no saved summary',
      should: 'offer the ordinary day record',
      actual: (await buildDayView(options)).summary,
      expected: null,
    })
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, SUMMARY)
    const view = await buildDayView(options)
    const app = createDayRoutes(options)
    await writeFile(file, SUMMARY.replace('Atlas found its first customer', 'The Atlas pilot began'))
    const updated = (await (await app.request(`/${DAY.ymd}/summary`)).json()) as { summary: DaySummary }
    assert({
      given: 'a summary beside a missing day.md, followed by an edit on disk',
      should: 'read the file afresh without requiring a day lifecycle change',
      actual: {
        dayFile: view.day.dayRelativePath,
        original: view.summary?.headline,
        headline: updated.summary.headline,
        versionChanged: updated.summary.version !== view.summary?.version,
        unchanged:
          (await readFile(file, 'utf8')) === SUMMARY.replace('Atlas found its first customer', 'The Atlas pilot began'),
        invalidDate: (await app.request('/not-a-day/summary')).status,
      },
      expected: {
        dayFile: null,
        original: 'Atlas found its first customer',
        headline: 'The Atlas pilot began',
        versionChanged: true,
        unchanged: true,
        invalidDate: 404,
      },
    })
    await rm(file)
    assert({
      given: 'the summary file is removed while its day is open',
      should: 'report its absence so the day record stays available',
      actual: await (await app.request(`/${DAY.ymd}/summary`)).json(),
      expected: { summary: null },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
