import { assert, test } from '#test'
import { buildExtractInstructions, buildExtractPrompt, groundedPlaces } from './extract.ts'

test('comprehensive extraction keeps every grounded place and the final section of a long document', () => {
  const places = Array.from({ length: 9 }, (_, i) => ({
    name: `Atlas City ${i}`,
    kind: 'city' as const,
    quote: `Atlas City ${i} changed its local transport rules.`,
  }))
  const body = 'Opening context. '.repeat(1000) + places.map((place) => place.quote).join('\n')
  const req = { body, comprehensive: true }
  assert({
    given: 'nine grounded subjects in the final section, beyond the ordinary excerpt and place count limit',
    should: 'keep all nine and expose the complete section to extraction',
    actual: {
      places: groundedPlaces(places, req),
      seesEnd: buildExtractPrompt(req).includes(places.at(-1)!.quote),
      uncapped: buildExtractInstructions(req).includes('There is no subject-count limit.'),
    },
    expected: { places, seesEnd: true, uncapped: true },
  })
})
