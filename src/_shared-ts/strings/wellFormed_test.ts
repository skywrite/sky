import { assert, test } from '#test'
import wellFormed from './wellFormed.ts'

/** U+1F600 — one code point, two UTF-16 code units. */
const GRIN = '😀'
/** A leading surrogate with nothing after it: what a mid-emoji cut leaves behind. */
const ORPHAN_HIGH = GRIN.charAt(0)
/** A trailing surrogate with nothing before it. */
const ORPHAN_LOW = GRIN.charAt(1)
/** U+FFFD — what any UTF-8 decoder produces for the same broken bytes. */
const REPLACEMENT = '�'

test('wellFormed', async (t) => {
  await t.step('repairs a stranded leading surrogate', () => {
    assert({
      given: 'text ending in half an emoji',
      should: 'replace the orphan with U+FFFD',
      actual: wellFormed(`report${ORPHAN_HIGH}`),
      expected: `report${REPLACEMENT}`,
    })
  })

  await t.step('repairs a stranded trailing surrogate', () => {
    assert({
      given: 'text starting with the back half of an emoji',
      should: 'replace the orphan with U+FFFD',
      actual: wellFormed(`${ORPHAN_LOW}report`),
      expected: `${REPLACEMENT}report`,
    })
  })

  await t.step('leaves intact emoji alone', () => {
    // The reassurance this whole change rests on: real emoji are never touched.
    const text = `ship it ${GRIN} 👨‍👩‍👧 🇬🇧 café`
    assert({
      given: 'emoji, a ZWJ family, a flag and combining marks — all well-formed',
      should: 'return them byte-identical',
      actual: wellFormed(text),
      expected: text,
    })
  })

  await t.step('returns the same reference when nothing needs repair', () => {
    // The allocation contract: clean payloads pass through untouched.
    const prompt = { role: 'user', content: [{ type: 'text', text: `hello ${GRIN}` }] }
    assert({
      given: 'an already well-formed value',
      should: 'return the identical object, not a copy',
      actual: wellFormed(prompt) === prompt,
      expected: true,
    })
  })

  await t.step('repairs strings nested in arrays and objects', () => {
    assert({
      given: 'an orphan buried in a nested prompt-shaped structure',
      should: 'repair it in place and leave the shape intact',
      actual: wellFormed([{ role: 'user', content: [{ type: 'text', text: `a${ORPHAN_HIGH}` }] }]),
      expected: [{ role: 'user', content: [{ type: 'text', text: `a${REPLACEMENT}` }] }],
    })
  })

  await t.step('leaves class instances by reference', () => {
    // File parts carry Uint8Array payloads; cloning them into plain objects
    // would corrupt the request far worse than the surrogate ever did.
    const bytes = new Uint8Array([0xd8, 0x3d])
    const part = { type: 'file', data: bytes, note: `x${ORPHAN_HIGH}` }
    const out = wellFormed(part)

    assert({
      given: 'a Uint8Array beside a string needing repair',
      should: 'keep the exact same array instance',
      actual: out.data === bytes,
      expected: true,
    })
    assert({
      given: 'the same object',
      should: 'still repair the sibling string',
      actual: out.note,
      expected: `x${REPLACEMENT}`,
    })
  })

  await t.step('passes non-string primitives through', () => {
    assert({
      given: 'numbers, booleans, null and undefined',
      should: 'return them unchanged',
      actual: wellFormed({ n: 1, b: true, nul: null, und: undefined }),
      expected: { n: 1, b: true, nul: null, und: undefined },
    })
  })

  await t.step('makes the repaired value safe to serialize', () => {
    const escaped = JSON.stringify(wellFormed({ text: `turn${ORPHAN_HIGH}` }))
    assert({
      given: 'a repaired payload serialized to JSON',
      should: 'contain no unpaired surrogate escape',
      actual: /\\u[dD][89abAB][0-9a-fA-F]{2}(?!\\u[dD][c-fC-F])/.test(escaped),
      expected: false,
    })
  })
})
