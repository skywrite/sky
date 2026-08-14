import { assert, test } from '#test'
import { appendWeekNext } from './weekNext.ts'

const EXISTING = `---
---

# Next Actions

## Week-Next

- Vendor keep/drop decision (pushed 2026-W33)

## Next

- Handwritten item [some-ref][]

[some-ref]: https://example.com/thread
`

test('appendWeekNext - appends into the existing section with provenance', () => {
  const updated = appendWeekNext(EXISTING, ['Quarterly narrative draft'], '2026-W34')

  assert({
    given: 'a file with a Week-Next section',
    should: 'append at the end of that list, suffixed with the pushing week',
    actual: updated.includes(
      '- Vendor keep/drop decision (pushed 2026-W33)\n- Quarterly narrative draft (pushed 2026-W34)\n\n## Next',
    ),
    expected: true,
  })
  assert({
    given: 'the rest of the file',
    should: 'be byte-identical outside the section',
    actual:
      updated.includes('- Handwritten item [some-ref][]') && updated.includes('[some-ref]: https://example.com/thread'),
    expected: true,
  })
})

test('appendWeekNext - creates the section after the H1 when missing', () => {
  const updated = appendWeekNext('# Next Actions\n\n## Next\n\n- Old item\n', ['New thing'], '2026-W34')

  assert({
    given: 'a file without a Week-Next section',
    should: 'create it right after the H1',
    actual: updated.startsWith('# Next Actions\n\n## Week-Next\n- New thing (pushed 2026-W34)'),
    expected: true,
  })
})

test('appendWeekNext - finds the heading wherever the user moved it', () => {
  const moved = '# Next Actions\n\n## Next\n\n- Old item\n\n## Week-Next\n\n- Parked (pushed 2026-W32)\n'
  const updated = appendWeekNext(moved, ['New thing'], '2026-W34')

  assert({
    given: 'Week-Next moved below Next',
    should: 'append into it there, not create a duplicate',
    actual:
      updated.includes('- Parked (pushed 2026-W32)\n- New thing (pushed 2026-W34)') &&
      updated.indexOf('## Week-Next') === updated.lastIndexOf('## Week-Next'),
    expected: true,
  })
})

test('appendWeekNext - skips items already present', () => {
  const updated = appendWeekNext(EXISTING, ['Vendor keep/drop decision'], '2026-W34')

  assert({
    given: 'an item already in the section (older push suffix)',
    should: 'not duplicate it',
    actual: updated,
    expected: EXISTING,
  })
})

test('appendWeekNext - no items, no change', () => {
  assert({
    given: 'an empty item list',
    should: 'return the file untouched',
    actual: appendWeekNext(EXISTING, [], '2026-W34'),
    expected: EXISTING,
  })
})
