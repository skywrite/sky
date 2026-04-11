import { assert, test } from '#test'
import { visionFromBytes } from './vision.ts'

/**
 * A minimal 1x1 red pixel PNG (base64 decoded to Uint8Array)
 * This is a valid PNG file that can be used for testing
 */
function createTestImage(): Uint8Array {
  // This is a 1x1 red pixel PNG in base64
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
  // Decode base64 to binary string
  const binaryString = atob(base64)
  // Convert to Uint8Array
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

test('visionFromBytes - analyzes image and returns text', async () => {
  const imageBytes = createTestImage()

  const response = await visionFromBytes(imageBytes, {
    prompt: 'What color is this image? Answer with just the color name.',
    maxTokens: 50,
  })

  assert({
    given: 'a red 1x1 pixel image',
    should: 'return a non-empty response',
    actual: response.length > 0,
    expected: true,
  })

  assert({
    given: 'a red 1x1 pixel image',
    should: 'return a string',
    actual: typeof response,
    expected: 'string',
  })
})

test('visionFromBytes - throws error when API key is missing', async () => {
  const imageBytes = createTestImage()

  try {
    await visionFromBytes(imageBytes, {
      prompt: 'Test prompt',
      apiKey: '', // Empty API key should trigger error
    })

    // If we get here, the test failed
    assert({
      given: 'empty API key',
      should: 'throw an error',
      actual: false,
      expected: true,
    })
  } catch (error) {
    assert({
      given: 'empty API key',
      should: 'throw an error',
      actual: error instanceof Error,
      expected: true,
    })

    assert({
      given: 'empty API key',
      should: 'mention API key in error message',
      actual: (error as Error).message.toLowerCase().includes('api'),
      expected: true,
    })
  }
})

test('visionFromBytes - handles custom model parameter', async () => {
  const imageBytes = createTestImage()

  const response = await visionFromBytes(imageBytes, {
    prompt: 'Describe this image in one word.',
    model: 'gpt-4o-mini', // Explicitly set model
    maxTokens: 20,
  })

  assert({
    given: 'custom model parameter',
    should: 'return a response',
    actual: response.length > 0,
    expected: true,
  })
})
