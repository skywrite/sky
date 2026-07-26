import { assert, test } from '#test'
import truncate from './truncate.ts'

/** U+1F600 — one code point, two UTF-16 code units. */
const GRIN = '😀'

/** A `\uD800`-`\uDBFF` escape not followed by a low-surrogate escape — what the model API's JSON parser rejects. */
const UNPAIRED_ESCAPE = /\\u[dD][89abAB][0-9a-fA-F]{2}(?!\\u[dD][c-fC-F])/

test('truncate', async (t) => {
  await t.step('leaves text shorter than the limit alone', () => {
    assert({
      given: 'text shorter than the limit',
      should: 'return it with no suffix appended',
      actual: truncate('short', 10, '...'),
      expected: 'short',
    })
  })

  await t.step('leaves text exactly at the limit alone', () => {
    assert({
      given: 'text exactly as long as the limit',
      should: 'return it with no suffix appended',
      actual: truncate('exactly10!', 10, '...'),
      expected: 'exactly10!',
    })
  })

  await t.step('cuts at the limit and appends the suffix', () => {
    assert({
      given: 'text longer than the limit',
      should: 'keep the limit and append the suffix',
      actual: truncate('abcdefghijklmno', 10, '...'),
      expected: 'abcdefghij...',
    })
  })

  await t.step('appends nothing when no suffix is given', () => {
    assert({
      given: 'no suffix argument',
      should: 'return the bare truncation',
      actual: truncate('abcdefghijklmno', 10),
      expected: 'abcdefghij',
    })
  })

  await t.step('drops an emoji the limit would split', () => {
    // The ai:context:evolve failure in miniature: the cut fell between an
    // emoji's two code units, leaving a lone leading surrogate.
    assert({
      given: "a limit falling between an emoji's two code units",
      should: 'drop the whole emoji rather than strand half of it',
      actual: truncate('a'.repeat(9) + GRIN, 10),
      expected: 'a'.repeat(9),
    })
  })

  await t.step('keeps an emoji that ends on the limit', () => {
    assert({
      given: 'a limit falling exactly after a complete emoji',
      should: 'keep the emoji',
      actual: truncate('a'.repeat(8) + GRIN + 'tail', 10),
      expected: 'a'.repeat(8) + GRIN,
    })
  })

  await t.step('stays well-formed at every cut point', () => {
    const text = `${GRIN}a${GRIN}${GRIN}bc${GRIN}`
    const cuts = Array.from({ length: text.length + 2 }, (_, i) => i)

    assert({
      given: 'every cut point of an emoji-dense string',
      should: 'never strand a surrogate',
      actual: cuts.filter((max) => !truncate(text, max).isWellFormed()),
      expected: [] as number[],
    })

    // Guards the guard: the plain slice this helper replaces does strand
    // surrogates on this fixture, so the assertion above is not vacuous.
    assert({
      given: 'the same cut points taken with a plain slice',
      should: 'strand a surrogate — the bug this helper exists to prevent',
      actual: cuts.some((max) => !text.slice(0, max).isWellFormed()),
      expected: true,
    })
  })

  await t.step('serializes to JSON a model API will accept', () => {
    // The exact production shape: a chat turn truncated to 300 units by
    // ai:context:evolve, with an emoji straddling unit 300.
    const turn = 'a'.repeat(299) + GRIN + ' and the rest of the message'

    assert({
      given: 'a chat turn whose 300-unit cut splits an emoji',
      should: 'serialize with no unpaired surrogate escape',
      actual: UNPAIRED_ESCAPE.test(JSON.stringify({ content: truncate(turn, 300, '...') })),
      expected: false,
    })

    assert({
      given: 'the same turn cut by a plain slice',
      should: 'serialize with the unpaired escape the API rejected',
      actual: UNPAIRED_ESCAPE.test(JSON.stringify({ content: turn.slice(0, 300) + '...' })),
      expected: true,
    })
  })
})
