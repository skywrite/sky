import { assert, test } from '#test'
import { listModels } from './listModels.ts'

// Ollama is a local service — skip when it isn't running (e.g. CI).
const ignore = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1000) })
  .then((r) => !r.ok)
  .catch(() => true)

test('listModels - returns array of model names', { ignore }, async () => {
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
