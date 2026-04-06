import { assert, test } from '#test'
import { listModels } from './listModels.ts'

test('listModels - returns array of model IDs', async () => {
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
