import { assert, test } from '#test'
import { accountCategory } from './accountCategory.ts'

test('an account files under the category chosen for it, and Professional otherwise', () => {
  const config = { google: { accountCategories: { 'jane.doe@example.com': 'Personal' as const } } }

  assert({
    given: 'an account chosen as Personal, asked for in another case and with stray spaces',
    should: 'find its choice',
    actual: accountCategory(' Jane.Doe@Example.com ', config),
    expected: 'Personal',
  })
  assert({
    given: 'an account nobody chose for, and a file with no Google section at all',
    should: 'file as Professional, as before the choice existed',
    actual: [accountCategory('jane@atlas.example', config), accountCategory('jane.doe@example.com', {})],
    expected: ['Professional', 'Professional'],
  })
})
