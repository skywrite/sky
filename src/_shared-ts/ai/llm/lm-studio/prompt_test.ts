import { assert, test } from '#test'
import * as lmStudio from './mod.ts'

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
  test(`lmStudio.prompt - ${fixture.description}`, async () => {
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
