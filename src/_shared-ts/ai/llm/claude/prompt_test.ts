import { assert, test } from '#test'
import * as claude from './mod.ts'

const fixtures = [
  {
    prompt: 'What is 2+2? Answer with only the number.',
    jsonMode: false,
    shouldContain: '4',
    description: 'basic math question returns answer',
  },
  {
    prompt: 'What is the capital of France? Answer with one word.',
    jsonMode: false,
    shouldContain: 'Paris',
    description: 'geography question returns answer',
  },
  {
    prompt: 'Return a JSON object with name="test" and count=42',
    jsonMode: true,
    shouldNotStartWith: '```',
    shouldParse: true,
    description: 'JSON mode strips markdown fences',
  },
  {
    prompt: 'Return JSON with fields: color (string), number (integer). Make color="blue" and number=7.',
    jsonMode: true,
    shouldNotStartWith: '```',
    shouldParse: true,
    description: 'JSON mode with specific values',
  },
]

fixtures.forEach((fixture) => {
  test(`claude.prompt - ${fixture.description}`, async () => {
    const response = await claude.prompt({
      prompt: fixture.prompt,
      jsonMode: fixture.jsonMode,
    })

    if (fixture.shouldContain) {
      assert({
        given: fixture.description,
        should: `contain "${fixture.shouldContain}"`,
        actual: response.includes(fixture.shouldContain),
        expected: true,
      })
    }

    if (fixture.shouldNotStartWith) {
      assert({
        given: fixture.description,
        should: `not start with "${fixture.shouldNotStartWith}"`,
        actual: response.startsWith(fixture.shouldNotStartWith),
        expected: false,
      })
    }

    if (fixture.shouldParse) {
      assert({
        given: fixture.description,
        should: 'be valid parseable JSON',
        actual: typeof JSON.parse(response),
        expected: 'object',
      })
    }
  })
})

test('claude.prompt - JSON mode with complex structure', async () => {
  const recipeText = `Chocolate Chip Cookies - Mix 2 cups flour, 1 cup butter, 1 cup sugar, 2 eggs, 1 tsp vanilla, 1 tsp baking soda, 2 cups chocolate chips. Bake at 375°F for 10-12 minutes. Makes 48 cookies.`

  const response = await claude.prompt({
    prompt: `Analyze this recipe and return JSON with: recipe_name, servings, temperature (object with value and unit), ingredients (array of objects with amount, unit, item). Recipe: ${recipeText}`,
    jsonMode: true,
  })

  const parsed = JSON.parse(response)

  const structureChecks = [
    { field: 'recipe_name', expectedType: 'string' },
    { field: 'servings', expectedType: 'number' },
    { field: 'temperature', expectedType: 'object' },
  ]

  structureChecks.forEach((check) => {
    assert({
      given: 'a recipe analysis prompt',
      should: `extract ${check.field} as ${check.expectedType}`,
      actual: typeof parsed[check.field],
      expected: check.expectedType,
    })
  })

  assert({
    given: 'a recipe analysis prompt',
    should: 'have temperature value as number',
    actual: typeof parsed.temperature.value,
    expected: 'number',
  })

  assert({
    given: 'a recipe analysis prompt',
    should: 'extract ingredients as array',
    actual: Array.isArray(parsed.ingredients),
    expected: true,
  })

  assert({
    given: 'a recipe analysis prompt',
    should: 'have ingredient objects with required fields',
    actual:
      parsed.ingredients.length > 0 &&
      typeof parsed.ingredients[0].amount === 'number' &&
      typeof parsed.ingredients[0].unit === 'string' &&
      typeof parsed.ingredients[0].item === 'string',
    expected: true,
  })
})
