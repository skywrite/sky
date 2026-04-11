import { assert, test } from '#test'
import padCenter from './padCenter.ts'

test(padCenter.name, () => {
  assert({
    actual: padCenter('NAME', 8),
    expected: '  NAME  ',
  })

  assert({
    given: 'string greater than length',
    should: 'return itself',
    actual: padCenter('NAME', 2),
    expected: 'NAME',
  })

  assert({
    given: 'length uneven',
    should: 'return string centered offset by 1 to the left',
    actual: padCenter('NAME', 7),
    expected: ' NAME  ',
  })
})
