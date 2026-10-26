import { assert, test } from '#test'
import { MAP_TYPE_DIR, selectGooglePlaceType } from './_google.ts'

const cases = [
  {
    given: 'a hotel with establishment before lodging',
    types: ['establishment', 'lodging', 'point_of_interest'],
    expected: 'stay',
  },
  {
    given: 'a cafe with generic tags before its venue type',
    types: ['point_of_interest', 'food', 'establishment', 'cafe'],
    expected: 'drink',
  },
  {
    given: 'a modern hotel type',
    types: ['establishment', 'hotel'],
    expected: 'stay',
  },
  {
    given: 'an unmapped food subtype with generic tags first',
    types: ['establishment', 'point_of_interest', 'sample_food_type', 'food'],
    expected: 'eat',
  },
  {
    given: 'a shop with generic tags first',
    types: ['point_of_interest', 'establishment', 'store'],
    expected: 'shop',
  },
  {
    given: 'an establishment without a specific type',
    types: ['establishment'],
    expected: 'visit',
  },
  {
    given: 'only unmapped types',
    types: ['sample_unknown_type', 'constructor'],
    expected: undefined,
  },
  {
    given: 'no provider types',
    types: undefined,
    expected: undefined,
  },
]

for (const { given, types, expected } of cases) {
  test(`Google place category: ${given}`, () => {
    const type = selectGooglePlaceType(types)
    assert({
      given,
      should: 'prefer a specific category and use broad types only as fallbacks',
      actual: type ? MAP_TYPE_DIR[type] : undefined,
      expected,
    })
  })
}
