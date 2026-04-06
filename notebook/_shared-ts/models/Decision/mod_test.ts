import { assert, test } from '#test'
import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'fixtures')

test(`DecisionDocument.fromMarkdown() with pending decision fixture`, async () => {
  const given = 'Parse Decision from fixture file'
  const markdown = await readTextFile(path.join(DIR_FIXTURES, 'basic-decision.md'))
  const d = DecisionDocument.fromMarkdown(markdown)

  assert({
    given,
    should: 'parse name correctly',
    expected: 'hire-sarah-vp-engineering',
    actual: d.name,
  })

  assert({
    given,
    should: 'parse identified date correctly',
    expected: '2026-01-15',
    actual: d.identified?.date,
  })

  assert({
    given,
    should: 'parse identified time correctly',
    expected: '10:30',
    actual: d.identified?.time,
  })

  assert({
    given,
    should: 'parse identified timezone correctly',
    expected: 'America/Chicago',
    actual: d.identified?.timezone,
  })

  assert({
    given,
    should: 'have no resolved date (pending)',
    expected: undefined,
    actual: d.resolved,
  })

  assert({
    given,
    should: 'be pending',
    expected: true,
    actual: d.isPending,
  })

  assert({
    given,
    should: 'parse tags correctly',
    expected: 'hiring; leadership',
    actual: String(d.tags),
  })

  assert({
    given,
    should: 'parse rel correctly',
    expected: true,
    actual: d.rel.has('acme/sarah'),
  })
})

test(`DecisionDocument.fromMarkdown() with resolved decision fixture`, async () => {
  const given = 'Parse resolved Decision from fixture file'
  const markdown = await readTextFile(path.join(DIR_FIXTURES, 'resolved-decision.md'))
  const d = DecisionDocument.fromMarkdown(markdown)

  assert({
    given,
    should: 'parse name correctly',
    expected: 'q1-pricing-strategy',
    actual: d.name,
  })

  assert({
    given,
    should: 'have resolved date',
    expected: '2026-01-19',
    actual: d.resolved?.date,
  })

  assert({
    given,
    should: 'have resolved time',
    expected: '14:00',
    actual: d.resolved?.time,
  })

  assert({
    given,
    should: 'not be pending',
    expected: false,
    actual: d.isPending,
  })
})

test(`Decision roundtrip`, async () => {
  const markdown = await readTextFile(path.join(DIR_FIXTURES, 'basic-decision.md'))
  const decision = DecisionDocument.fromMarkdown(markdown)

  assert({
    given: 'fromMarkdown -> toMarkdown',
    should: 'produce identical markdown',
    expected: markdown,
    actual: decision.toMarkdown(),
  })
})

test(`DecisionDocument.create()`, () => {
  const given = 'Create Decision with props'
  const identified = new ZonedDateTime('2026-01-20 09:00', 'America/Chicago')
  const d = DecisionDocument.create({
    name: 'test-decision',
    identified,
    title: 'Test Decision Title',
    context: 'Some context here.',
    tags: 'test; example',
    rel: ['acme/person1'],
  })

  assert({
    given,
    should: 'have correct name',
    expected: 'test-decision',
    actual: d.name,
  })

  assert({
    given,
    should: 'have identified date',
    expected: '2026-01-20',
    actual: d.identified?.date,
  })

  assert({
    given,
    should: 'have identified timezone',
    expected: 'America/Chicago',
    actual: d.identified?.timezone,
  })

  assert({
    given,
    should: 'be pending (no resolved)',
    expected: true,
    actual: d.isPending,
  })

  assert({
    given,
    should: 'have created date',
    expected: true,
    actual: d.created !== undefined,
  })

  assert({
    given,
    should: 'have tags',
    expected: 'test; example',
    actual: String(d.tags),
  })

  assert({
    given,
    should: 'have rel',
    expected: true,
    actual: d.rel.has('acme/person1'),
  })
})

test(`DecisionDocument.create() with minimal props`, () => {
  const given = 'Create Decision with minimal props'
  const d = DecisionDocument.create({ name: 'minimal-decision' })

  assert({
    given,
    should: 'have name',
    expected: 'minimal-decision',
    actual: d.name,
  })

  assert({
    given,
    should: 'have identified (defaults to now)',
    expected: true,
    actual: d.identified !== undefined,
  })

  assert({
    given,
    should: 'be pending',
    expected: true,
    actual: d.isPending,
  })
})

test(`Decision.toMarkdown()`, () => {
  const given = 'Create Decision and render to markdown'
  const d = DecisionDocument.create({
    name: 'markdown-test',
    title: 'Markdown Test Decision',
    context: 'Testing context.',
  })
  const md = d.toMarkdown()

  assert({
    given,
    should: 'include yaml frontmatter',
    expected: true,
    actual: md.includes('---'),
  })

  assert({
    given,
    should: 'include name field',
    expected: true,
    actual: md.includes('name: markdown-test'),
  })

  assert({
    given,
    should: 'include identified field',
    expected: true,
    actual: md.includes('identified:'),
  })

  assert({
    given,
    should: 'include markdown heading',
    expected: true,
    actual: md.includes('# Markdown Test Decision'),
  })

  assert({
    given,
    should: 'include context content',
    expected: true,
    actual: md.includes('Testing context.'),
  })

  assert({
    given,
    should: 'include Outcome section',
    expected: true,
    actual: md.includes('## Outcome'),
  })
})

test(`Decision.resolve()`, () => {
  const given = 'Create pending decision and resolve it'
  const d = DecisionDocument.create({ name: 'resolve-test' })

  assert({
    given,
    should: 'start as pending',
    expected: true,
    actual: d.isPending,
  })

  const resolvedAt = new ZonedDateTime('2026-01-25 15:00', 'America/Chicago')
  const resolvedDoc = d.resolve(resolvedAt)

  assert({
    given,
    should: 'no longer be pending after resolve',
    expected: false,
    actual: resolvedDoc.isPending,
  })

  assert({
    given,
    should: 'have resolved date',
    expected: '2026-01-25',
    actual: resolvedDoc.resolved?.date,
  })

  assert({
    given,
    should: 'have resolved time',
    expected: '15:00',
    actual: resolvedDoc.resolved?.time,
  })

  assert({
    given,
    should: 'preserve original name',
    expected: 'resolve-test',
    actual: resolvedDoc.name,
  })
})

test(`DecisionDocument.formatZonedDateTime()`, () => {
  const given = 'Format ZonedDateTime for YAML'
  const zdt = new ZonedDateTime('2026-01-15 10:30', 'America/Chicago')
  const formatted = DecisionDocument.formatZonedDateTime(zdt)

  assert({
    given,
    should: 'include timezone in brackets',
    expected: true,
    actual: formatted.includes('[America/Chicago]'),
  })

  assert({
    given,
    should: 'include date',
    expected: true,
    actual: formatted.includes('2026-01-15'),
  })

  assert({
    given,
    should: 'include time',
    expected: true,
    actual: formatted.includes('10:30'),
  })
})
