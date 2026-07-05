import { assert, test } from '#test'
import * as lmStudio from './mod.ts'

/** Returns a skip reason when LM Studio isn't reachable or the default model isn't available, else null. */
async function lmStudioSkipReason(): Promise<string | null> {
  try {
    const response = await fetch('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return `LM Studio responded with ${response.status}`
    const { data } = (await response.json()) as { data: Array<{ id: string }> }
    if (!data.some((model) => model.id === lmStudio.DEFAULT_MODEL)) {
      return `model ${lmStudio.DEFAULT_MODEL} is not available in LM Studio`
    }
    return null
  } catch {
    return 'LM Studio is not running on localhost:1234'
  }
}

const skipReason = await lmStudioSkipReason()
if (skipReason) console.warn(`Skipping LM Studio tests: ${skipReason}`)

const fixtures = [
  {
    prompt: 'What is 2+2? Answer with only the number.',
    shouldContain: '4',
    description: 'basic math question returns answer',
  },
  {
    prompt: 'What is the capital of France? Answer with only the city name.',
    shouldContain: 'Paris',
    description: 'geography question returns answer',
  },
]

fixtures.forEach((fixture) => {
  test(`lmStudio.prompt - ${fixture.description}`, { ignore: skipReason !== null }, async () => {
    const response = await lmStudio.prompt({
      prompt: fixture.prompt,
    })

    assert({
      given: fixture.description,
      should: 'return a non-empty response',
      actual: response.length > 0,
      expected: true,
    })

    if (fixture.shouldContain) {
      assert({
        given: fixture.description,
        should: `contain "${fixture.shouldContain}"`,
        actual: response.includes(fixture.shouldContain),
        expected: true,
      })
    }
  })
})
