import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { buildMIBody } from './miDocument.ts'

test('buildMIBody - assembles enriched sections with bullet outcomes', () => {
  const body = buildMIBody(
    {
      focus: 'Ship the pricing page to production before the 15:00 review.',
      whyThisMatters: 'The board asked twice; shipping today is the visible commitment.',
      doneLooksLike: ['Page live in production', 'Announcement sent'],
      notes: 'Skip the FAQ rewrite',
    },
    new PlainDate(2025, 10, 1),
  )

  assert({
    given: 'a doneLooksLike array',
    should: 'render as checkable bullets',
    actual: body.includes('- Page live in production\n- Announcement sent'),
    expected: true,
  })

  assert({
    given: 'a body',
    should: 'carry the standard headings and empty Reflection',
    actual:
      body.includes('## Focus') &&
      body.includes('## Why This Matters') &&
      body.includes('## Done Looks Like') &&
      body.includes('## Notes') &&
      body.endsWith('## Reflection\n\n'),
    expected: true,
  })

  assert({
    given: 'no dependencies section',
    should: 'omit the Dependencies heading',
    actual: body.includes('## Dependencies'),
    expected: false,
  })
})

test('buildMIBody - raw-answer fallback renders strings as written', () => {
  const body = buildMIBody(
    {
      focus: 'Ship it',
      whyThisMatters: 'Board asked twice.\nVisible commitment.',
      doneLooksLike: 'Page live, announcement sent',
    },
    new PlainDate(2025, 10, 1),
  )

  assert({
    given: 'raw multi-line strategic text (enrichment failed)',
    should: 'keep it as written, newlines intact',
    actual: body.includes('Board asked twice.\nVisible commitment.'),
    expected: true,
  })

  assert({
    given: 'a raw doneLooksLike string',
    should: 'render without bullet markers',
    actual: body.includes('Page live, announcement sent') && !body.includes('- Page live'),
    expected: true,
  })
})

test('buildMIBody - empty sections render as (not provided)', () => {
  const body = buildMIBody({ focus: 'Ship it', whyThisMatters: '', doneLooksLike: '' }, new PlainDate(2025, 10, 1))

  assert({
    given: 'empty whyThisMatters and doneLooksLike',
    should: 'mark both as not provided',
    actual: (body.match(/\(not provided\)/g) ?? []).length,
    expected: 2,
  })
})
