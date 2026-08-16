import { assert, test } from '#test'
import RecapDocument from './mod.ts'

test('RecapDocument.create round-trips through markdown', () => {
  const doc = RecapDocument.create({
    app: 'github',
    what: 'Code - GitHub',
    when: '2026-02-08 09:12 - 25:44',
    rel: ['projects/atlas'],
    body: '# GitHub — Feb 8\n\n## acme/atlas (2 commits)\n',
  })

  const parsed = RecapDocument.fromMarkdown(doc.toMarkdown())

  assert({
    given: 'a created recap parsed back from markdown',
    should: 'keep the app field',
    expected: 'github',
    actual: parsed.app,
  })

  assert({
    given: 'a created recap parsed back from markdown',
    should: 'keep the what field',
    expected: 'Code - GitHub',
    actual: parsed.what,
  })

  assert({
    given: 'a when span with an extended-hours end',
    should: 'round-trip without normalizing 25:44',
    expected: '2026-02-08 09:12 - 25:44',
    actual: parsed.when?.toString(),
  })

  assert({
    given: 'a rel list',
    should: 'keep it as a list',
    expected: ['projects/atlas'],
    actual: [...parsed.rel],
  })

  assert({
    given: 'the body',
    should: 'survive the round-trip',
    expected: true,
    actual: parsed.markdown.includes('## acme/atlas (2 commits)'),
  })
})

test('RecapDocument.create without a when omits the field', () => {
  const doc = RecapDocument.create({ app: 'claude-code', what: 'Coding - Claude Code', body: '# Claude Code\n' })

  assert({
    given: 'a recap created without a when',
    should: 'have no when value',
    expected: undefined,
    actual: doc.when,
  })
})

test('RecapDocument.create always carries rel and tags as empty slots', () => {
  const doc = RecapDocument.create({ app: 'github', what: 'Code - GitHub', body: '# GitHub\n' })

  assert({
    given: 'a recap created without rel or tags',
    should: 'still carry both keys as empty slots',
    expected: 'true null / true null',
    actual: `${'rel' in doc.yaml} ${doc.yaml['rel']} / ${'tags' in doc.yaml} ${doc.yaml['tags']}`,
  })
})

test('RecapDocument normalizes tags to the scalar form', () => {
  const doc = new RecapDocument({ app: 'github', tags: ['code', 'oss'] })

  assert({
    given: 'tags passed as an array',
    should: 'store them as a single string',
    expected: 'string',
    actual: typeof doc.yaml['tags'],
  })
})
