import isOnline from '#shared/network/isOnline.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { listModels } from './listModels.ts'

// Live API call — needs a key (absent on CI) and network.
const ignore = !env.get('ANTHROPIC_API_KEY') || !(await isOnline())

test('listModels - returns array of model IDs', { ignore }, async () => {
  const models = await listModels()

  assert({
    given: 'calling listModels',
    should: 'return an array',
    actual: Array.isArray(models),
    expected: true,
  })

  assert({
    given: 'calling listModels',
    should: 'return at least one model',
    actual: models.length > 0,
    expected: true,
  })

  assert({
    given: 'calling listModels',
    should: 'return model IDs as strings',
    actual: typeof models[0],
    expected: 'string',
  })
})
