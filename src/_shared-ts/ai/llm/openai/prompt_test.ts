import { assert, test } from '#test'
import * as openai from './mod.ts'

const fixtures = [
  {
    prompt: 'What is 3+3? Answer with only the number.',
    jsonMode: false,
    shouldContain: '6',
    description: 'basic math question returns answer',
  },
  {
    prompt: 'What is the capital of Germany? Answer with one word.',
    jsonMode: false,
    shouldContain: 'Berlin',
    description: 'geography question returns answer',
  },
  {
    prompt: 'Return a JSON object with name="openai" and version=4',
    jsonMode: true,
    shouldParse: true,
    description: 'JSON mode returns valid JSON',
  },
  {
    prompt: 'Return JSON with fields: animal (string), legs (integer). Make animal="dog" and legs=4.',
    jsonMode: true,
    shouldParse: true,
    description: 'JSON mode with specific values',
  },
]

fixtures.forEach((fixture) => {
  test(`openai.prompt - ${fixture.description}`, async () => {
    const response = await openai.prompt({
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

test('openai.prompt - JSON mode with complex structure', async () => {
  const recipeText = `Banana Bread - Mix 3 bananas, 2 cups flour, 1 cup sugar, 2 eggs, 1/2 cup butter, 1 tsp baking soda. Bake at 350°F for 60 minutes. Makes 1 loaf.`

  const response = await openai.prompt({
    prompt: `Analyze this recipe and return JSON with: recipe_name, servings, temperature (object with value and unit), ingredients (array of objects with amount, unit, item). Recipe: ${recipeText}`,
    jsonMode: true,
  })

  const parsed = JSON.parse(response)

  assert({
    given: 'a recipe analysis prompt',
    should: 'extract recipe_name',
    actual: typeof parsed.recipe_name,
    expected: 'string',
  })

  assert({
    given: 'a recipe analysis prompt',
    should: 'extract servings (number or string)',
    actual: typeof parsed.servings === 'number' || typeof parsed.servings === 'string',
    expected: true,
  })

  assert({
    given: 'a recipe analysis prompt',
    should: 'extract temperature object',
    actual: typeof parsed.temperature,
    expected: 'object',
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
    should: 'have ingredient objects with item field',
    actual: parsed.ingredients.length > 0 && typeof parsed.ingredients[0].item === 'string',
    expected: true,
  })
})
