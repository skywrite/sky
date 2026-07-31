import { assert, test } from '#test'
import { hexToRgb01, slideDesignPromptSection } from './design.ts'

test('hexToRgb01', () => {
  assert({
    given: 'white and black',
    should: 'map to the float extremes',
    expected: [
      { red: 1, green: 1, blue: 1 },
      { red: 0, green: 0, blue: 0 },
    ],
    actual: [hexToRgb01('#FFFFFF'), hexToRgb01('#000000')],
  })

  assert({
    given: 'the light accent color',
    should: 'round to 3-decimal floats',
    expected: { red: 0.145, green: 0.341, blue: 0.839 },
    actual: hexToRgb01('#2557D6'),
  })

  let threw = false
  try {
    hexToRgb01('2557D6')
  } catch {
    threw = true
  }
  assert({
    given: 'a hex string without #',
    should: 'throw',
    expected: true,
    actual: threw,
  })
})

test('slideDesignPromptSection', () => {
  const section = slideDesignPromptSection()

  assert({
    given: 'the design-token prompt section',
    should: 'carry fonts, computed EMU geometry, paste-ready floats, all three palettes, and the derive rule',
    expected: [true, true, true, true, true, true, true],
    actual: [
      section.includes('Montserrat'),
      section.includes('609600'),
      section.includes('9144000'),
      section.includes('"red":0.145'),
      section.includes('### dark'),
      section.includes('#C25E2E'),
      section.includes('derive your own five role values'),
    ],
  })
})
