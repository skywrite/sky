import { closeSync, openSync } from 'node:fs'
import { assert, test } from '#test'
import { openFdCount } from './openFdCount.ts'

test('openFdCount - counts the descriptors this process holds', () => {
  const before = openFdCount()

  assert({
    given: 'a running process',
    should: 'report a positive descriptor count',
    actual: before !== null && before > 0,
    expected: true,
  })

  const fds = Array.from({ length: 20 }, () => openSync('/dev/null', 'r'))
  const during = openFdCount()
  for (const fd of fds) closeSync(fd)
  const after = openFdCount()

  assert({
    given: '20 more descriptors opened',
    should: 'count at least 20 more',
    actual: during !== null && during >= before! + 20,
    expected: true,
  })

  assert({
    given: 'those descriptors closed again',
    should: 'drop back below the raised count',
    actual: after !== null && after < before! + 20,
    expected: true,
  })
})
