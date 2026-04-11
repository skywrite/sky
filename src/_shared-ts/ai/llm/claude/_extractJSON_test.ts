import { test } from '#test'
import { assert } from '#test'
import { extractJSON } from './_extractJSON.ts'

// Test fixtures for various JSON extraction scenarios
const fixtures = [
  {
    description: 'clean JSON object',
    input: '{"name": "test", "value": 123}',
    expected: '{"name": "test", "value": 123}',
    shouldSucceed: true,
  },
  {
    description: 'JSON with whitespace',
    input: '  \n  {"name": "test"}  \n  ',
    expected: '{"name": "test"}',
    shouldSucceed: true,
  },
  {
    description: 'JSON with markdown code fences',
    input: '```json\n{"name": "test"}\n```',
    expected: '{"name": "test"}',
    shouldSucceed: true,
  },
  {
    description: 'JSON with trailing text after closing brace',
    input: '{"name": "test", "value": 123}\n\nWait, let me reconsider...',
    expected: '{"name": "test", "value": 123}',
    shouldSucceed: true,
  },
  {
    description: 'JSON with markdown code fence and trailing text',
    input: '```json\n{"name": "test"}\n```\n\nActually, I need to reconsider this response.',
    expected: '{"name": "test"}',
    shouldSucceed: true,
  },
  {
    description: 'nested JSON object',
    input: '{"outer": {"inner": {"deep": "value"}}, "count": 42}',
    expected: '{"outer": {"inner": {"deep": "value"}}, "count": 42}',
    shouldSucceed: true,
  },
  {
    description: 'nested JSON with trailing text',
    input: '{"outer": {"inner": "value"}} Some reasoning here.',
    expected: '{"outer": {"inner": "value"}}',
    shouldSucceed: true,
  },
  {
    description: 'real-world example from org:new',
    input: `{
  "primary_sector": "industrials",
  "primary_subcategory": "tobacco",
  "confidence": "low",
  "kind": "company",
  "website": "https://rjrt.com"
}
\`\`\`

Wait, I need to reconsider this. Looking at the taxonomy provided, there is no "tobacco" subcategory.`,
    expected: `{
  "primary_sector": "industrials",
  "primary_subcategory": "tobacco",
  "confidence": "low",
  "kind": "company",
  "website": "https://rjrt.com"
}`,
    shouldSucceed: true,
  },
  {
    description: 'JSON array',
    input: '[{"id": 1}, {"id": 2}]',
    expected: '[{"id": 1}, {"id": 2}]',
    shouldSucceed: true, // JSON.parse handles arrays too
  },
  {
    description: 'no JSON present',
    input: 'This is just plain text without any JSON.',
    expected: '',
    shouldSucceed: false,
  },
  {
    description: 'malformed JSON',
    input: '{"name": "test", "value":',
    expected: '',
    shouldSucceed: false,
  },
  {
    description: 'JSON with leading text',
    input: 'Here is the JSON you requested: {"name": "test"}',
    expected: '{"name": "test"}',
    shouldSucceed: true,
  },
  {
    description: 'multiple JSON objects (returns first)',
    input: '{"first": 1} {"second": 2}',
    expected: '{"first": 1}',
    shouldSucceed: true,
  },
  {
    description: 'JSON with escaped braces in strings',
    input: '{"code": "function() { return {}; }", "value": 123}',
    expected: '{"code": "function() { return {}; }", "value": 123}',
    shouldSucceed: true,
  },
  {
    description: 'empty JSON object',
    input: '{}',
    expected: '{}',
    shouldSucceed: true,
  },
  {
    description: 'JSON with unicode characters',
    input: '{"emoji": "🤖", "text": "Hello 世界"}',
    expected: '{"emoji": "🤖", "text": "Hello 世界"}',
    shouldSucceed: true,
  },
  {
    description: 'JSON array with trailing text',
    input: '[{"id": 1}, {"id": 2}]\n\nHere are my results.',
    expected: '[{"id": 1}, {"id": 2}]',
    shouldSucceed: true,
  },
  {
    description: 'nested JSON array',
    input: '[{"items": [1, 2, 3]}, {"items": [4, 5, 6]}]',
    expected: '[{"items": [1, 2, 3]}, {"items": [4, 5, 6]}]',
    shouldSucceed: true,
  },
  {
    description: 'JSON array with leading text',
    input: 'The results are: [{"status": "ok"}]',
    expected: '[{"status": "ok"}]',
    shouldSucceed: true,
  },
]

fixtures.forEach((fixture) => {
  test(`extractJSON - ${fixture.description}`, () => {
    if (fixture.shouldSucceed) {
      const result = extractJSON(fixture.input)

      // Test 1: Should return expected string
      assert({
        given: fixture.description,
        should: 'extract valid JSON',
        actual: result,
        expected: fixture.expected,
      })

      // Test 2: Result should be parseable as JSON
      let parsed
      try {
        parsed = JSON.parse(result)
        assert({
          given: fixture.description,
          should: 'return parseable JSON',
          actual: typeof parsed,
          expected: 'object',
        })
      } catch (error) {
        assert({
          given: fixture.description,
          should: 'return parseable JSON',
          actual: false,
          expected: true,
        })
      }
    } else {
      // Should throw an error
      let didThrow = false
      try {
        extractJSON(fixture.input)
      } catch (error) {
        didThrow = true
      }

      assert({
        given: fixture.description,
        should: 'throw an error',
        actual: didThrow,
        expected: true,
      })
    }
  })
})

// Edge case: deeply nested object
test('extractJSON - deeply nested object', () => {
  const deeplyNested = {
    level1: {
      level2: {
        level3: {
          level4: {
            level5: {
              value: 'deep',
            },
          },
        },
      },
    },
  }
  const input = JSON.stringify(deeplyNested) + '\n\nSome extra text here.'
  const result = extractJSON(input)
  const parsed = JSON.parse(result)

  assert({
    given: 'deeply nested JSON object with trailing text',
    should: 'extract and parse correctly',
    actual: parsed.level1.level2.level3.level4.level5.value,
    expected: 'deep',
  })
})

// Edge case: JSON with newlines and indentation
test('extractJSON - formatted JSON with trailing text', () => {
  const input = `{
  "name": "Test Org",
  "sector": "tech",
  "nested": {
    "value": 123
  }
}

Let me explain my reasoning for this categorization...`

  const result = extractJSON(input)
  const parsed = JSON.parse(result)

  assert({
    given: 'formatted JSON with trailing explanation',
    should: 'extract complete object',
    actual: parsed.nested.value,
    expected: 123,
  })
})
