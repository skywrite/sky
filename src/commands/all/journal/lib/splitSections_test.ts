import { assert, test } from '#test'
import { buildEntryMarkdown, parseSectionedBody, validateGroups } from './splitSections.ts'

const BODY = [
  '## Summary',
  'Covers sleep and the launch.',
  '',
  '## Seven hours of sleep',
  'I slept seven hours last night.',
  '',
  '## The Atlas launch',
  'We pushed the launch a week.',
  'Jane agreed.',
  '',
  '## Back to sleep rules',
  'No screens after ten.',
].join('\n')

test('parseSectionedBody separates the recording summary from the sections', () => {
  const parsed = parseSectionedBody(BODY)

  assert({
    given: 'a body with a Summary section',
    should: 'capture it apart from the sections',
    actual: parsed.summary,
    expected: 'Covers sleep and the launch.',
  })
  assert({
    given: 'three topical sections',
    should: 'keep them in order with verbatim bodies',
    actual: parsed.sections.map((s) => s.heading),
    expected: ['Seven hours of sleep', 'The Atlas launch', 'Back to sleep rules'],
  })
  assert({
    given: 'a section body of two lines',
    should: 'keep both lines verbatim',
    actual: parsed.sections[1].body,
    expected: 'We pushed the launch a week.\nJane agreed.',
  })
  assert({
    given: 'word counting',
    should: 'count section words',
    actual: parsed.sections[0].words,
    expected: 6,
  })
})

test('validateGroups accepts only a perfect partition', () => {
  const ok = [
    { title: 'Sleep', summary: 's', sections: [0, 2] },
    { title: 'Launch', summary: 's', sections: [1] },
  ]
  assert({ given: 'a perfect partition', should: 'pass', actual: validateGroups(ok, 3), expected: undefined })
  assert({
    given: 'an unallocated section',
    should: 'name it',
    actual: validateGroups([{ title: 'A', summary: 's', sections: [0, 1] }], 3),
    expected: 'sections unallocated: 2',
  })
  assert({
    given: 'a doubly-allocated section',
    should: 'reject',
    actual: validateGroups(
      [
        { title: 'A', summary: 's', sections: [0, 1] },
        { title: 'B', summary: 's', sections: [1, 2] },
      ],
      3,
    ),
    expected: 'section allocated twice: 1',
  })
  assert({
    given: 'an out-of-range index',
    should: 'reject',
    actual: validateGroups([{ title: 'A', summary: 's', sections: [0, 3] }], 3),
    expected: 'section out of range: 3',
  })
  assert({
    given: 'no groups at all',
    should: 'reject',
    actual: validateGroups([], 3),
    expected: 'no groups',
  })
})

test('buildEntryMarkdown reassembles a group verbatim, in spoken order', () => {
  const parsed = parseSectionedBody(BODY)
  const markdown = buildEntryMarkdown(
    '# **Video: 2026-08-14 - Fri - 06:00**',
    { title: 'Sleep', summary: 'Sleep, and the rules that made it.', sections: [2, 0] },
    parsed.sections,
  )

  assert({
    given: 'a group listing its sections out of order',
    should: 'rebuild in spoken order with the entry summary',
    actual: markdown,
    expected: [
      '# **Video: 2026-08-14 - Fri - 06:00**',
      '',
      '## Summary',
      'Sleep, and the rules that made it.',
      '',
      '## Seven hours of sleep',
      '',
      'I slept seven hours last night.',
      '',
      '## Back to sleep rules',
      '',
      'No screens after ten.',
      '',
    ].join('\n'),
  })
})
