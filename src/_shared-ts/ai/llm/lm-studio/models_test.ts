import { assert, test } from '#test'
import { listModels } from './listModels.ts'

test('listModels - returns array of model names', async () => {
  const models = await listModels()

  assert({
    given: 'listModels called',
    should: 'return an array',
    actual: Array.isArray(models),
    expected: true,
  })

  // If models exist, verify they're sorted
  if (models.length > 1) {
    const sortedModels = [...models].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    assert({
      given: 'models returned',
      should: 'be sorted alphabetically',
      actual: JSON.stringify(models),
      expected: JSON.stringify(sortedModels),
    })
  }
})
