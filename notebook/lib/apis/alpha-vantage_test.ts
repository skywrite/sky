import { assert, test } from '#test'
import { fetchEquityPrice } from './alpha-vantage.ts'
import isOnline from '#shared/network/isOnline.ts'

const ignore = true // !(await isOnline())

test({ name: fetchEquityPrice.name, ignore }, async () => {
  const given = 'equity string' // has no parameters
  const should = 'return number representing price'

  let result = await fetchEquityPrice('TSLA')
  assert({ given, should, expected: true, actual: result > 0 && result < 1000 })

  result = await fetchEquityPrice('EXOD')
  assert({ given, should, expected: true, actual: result > 0 && result < 1000 })
})
