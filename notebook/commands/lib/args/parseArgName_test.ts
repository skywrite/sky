import { assert, test } from '#test'
import parseArgName from './parseArgName.ts'

test(parseArgName.name, () => {
  const given = 'standard arg name'
  const should = 'return arg name'

  const input = '<who>'

  const actual = parseArgName(input)
  const expected = 'who'

  assert({ given, should, actual, expected })

  assert({ given, should, actual: parseArgName(' <who>\n '), expected })
})

test(parseArgName.name, () => {
  const given = 'invalid input'
  const should = 'throw an error'

  const input = 'who>'

  let actual = false
  try {
    parseArgName(input)
  } catch (_e) {
    actual = true
  }

  const expected = true

  assert({ given, should, actual, expected })
})
