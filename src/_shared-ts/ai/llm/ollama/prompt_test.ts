import { assert, test } from '#test'
import * as ollama from './mod.ts'

function hasFieldDeep(obj: unknown, field: string): boolean {
  if (!obj || typeof obj !== 'object') return false
  if (field in (obj as Record<string, unknown>)) return true
  return Object.values(obj as Record<string, unknown>).some((v) => hasFieldDeep(v, field))
}

const fixtures = [
  {
    prompt: 'What is 2+2? Answer with only the number.',
    jsonMode: false,
    shouldContain: '4',
    description: 'basic math question returns answer',
  },
  {
    prompt: 'What is the capital of France? Answer with only the city name.',
    jsonMode: false,
    shouldContain: 'Paris',
    description: 'geography question returns answer',
  },
  {
    prompt: 'Create a JSON object with a single field "test" set to true',
    jsonMode: true,
    shouldBeValidJson: true,
    description: 'JSON mode returns valid JSON',
  },
  {
    prompt: 'Create a simple recipe JSON with name and servings fields. Set name to "Test Recipe" and servings to 4',
    jsonMode: true,
    shouldBeValidJson: true,
    shouldHaveField: 'name',
    shouldHaveField2: 'servings',
    description: 'JSON mode with specific values',
  },
]

fixtures.forEach((fixture) => {
  test(`ollama.prompt - ${fixture.description}`, async () => {
    const response = await ollama.prompt({
      prompt: fixture.prompt,
      jsonMode: fixture.jsonMode,
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

    if (fixture.shouldBeValidJson) {
      let parsed
      try {
        parsed = JSON.parse(response)
      } catch {
        // Ignore parse error, will be caught by assertion
      }

      assert({
        given: fixture.description,
        should: 'return valid JSON',
        actual: parsed !== undefined,
        expected: true,
      })

      if (fixture.shouldHaveField) {
        assert({
          given: fixture.description,
          should: `have field "${fixture.shouldHaveField}"`,
          actual: hasFieldDeep(parsed, fixture.shouldHaveField),
          expected: true,
        })
      }

      if (fixture.shouldHaveField2) {
        assert({
          given: fixture.description,
          should: `have field "${fixture.shouldHaveField2}"`,
          actual: hasFieldDeep(parsed, fixture.shouldHaveField2),
          expected: true,
        })
      }
    }
  })
})
