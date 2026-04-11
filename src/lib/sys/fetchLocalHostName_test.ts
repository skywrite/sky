import { assert, test } from '#test'
import fetchLocalHostName from './fetchLocalHostName.ts'

test(fetchLocalHostName.name, async () => {
  const given = ''
  const should = 'return computer name in sluggified form'

  const hostname = await fetchLocalHostName()
  const actual = typeof hostname === 'string' && hostname.length > 0

  assert({ given, should, expected: true, actual })
})
