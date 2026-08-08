import IdeaDocument from '#shared/models/Idea/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { assert, test } from '#test'

test(`IdeaDocument.create()`, () => {
  const given = 'Create Idea with props'
  const d = IdeaDocument.create({
    name: 'ai-daily-review',
    title: 'AI Daily Review',
    body: 'An AI coach that reviews the day.',
    tags: TagSet.fromArray(['ai', 'notebook']),
    rel: ['acme/jane-doe'],
    createdOn: '2026-03-05',
  })

  assert({
    given,
    should: 'have name',
    expected: 'ai-daily-review',
    actual: d.name,
  })

  assert({
    given,
    should: 'store tags with the semicolon separator',
    expected: 'ai; notebook',
    actual: String(d.tags),
  })

  assert({
    given,
    should: 'have rel',
    expected: true,
    actual: d.rel.has('acme/jane-doe'),
  })

  assert({
    given,
    should: 'stamp created from createdOn, not the system clock',
    expected: '2026-03-05',
    actual: d.created?.ymd,
  })

  assert({
    given,
    should: 'stamp updated from createdOn as well',
    expected: '2026-03-05',
    actual: d.updated?.ymd,
  })

  assert({
    given,
    should: 'render title heading',
    expected: true,
    actual: d.toMarkdown().includes('# AI Daily Review'),
  })
})

test(`IdeaDocument.create() with minimal props`, () => {
  const given = 'Create Idea with minimal props'
  const d = IdeaDocument.create({ name: 'minimal-idea' })

  assert({
    given,
    should: 'have name',
    expected: 'minimal-idea',
    actual: d.name,
  })

  assert({
    given,
    should: 'default created to today',
    expected: true,
    actual: d.created !== undefined,
  })
})
