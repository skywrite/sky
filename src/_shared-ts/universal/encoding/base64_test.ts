import { assert, test } from '#test'
import { decodeBase64, encodeBase64 } from './base64.ts'

const fixtures = [
  // String test cases
  {
    decoded: 'hello',
    encoded: 'aGVsbG8=',
    description: 'simple string',
  },
  {
    decoded: 'foobar',
    encoded: 'Zm9vYmFy',
    description: 'string without padding',
  },
  {
    decoded: 'Hello, World!',
    encoded: 'SGVsbG8sIFdvcmxkIQ==',
    description: 'string with special characters',
  },
  {
    decoded: '',
    encoded: '',
    description: 'empty string',
  },
  {
    decoded: 'a',
    encoded: 'YQ==',
    description: 'single character',
  },
  {
    decoded: 'The quick brown fox jumps over the lazy dog',
    encoded: 'VGhlIHF1aWNrIGJyb3duIGZveCBqdW1wcyBvdmVyIHRoZSBsYXp5IGRvZw==',
    description: 'long string',
  },
  // Uint8Array test cases
  {
    decoded: new Uint8Array([102, 111, 111, 98, 97, 114]), // "foobar"
    encoded: 'Zm9vYmFy',
    description: 'Uint8Array',
  },
  {
    decoded: new Uint8Array([0, 1, 2, 255, 254, 253]),
    encoded: 'AAEC//79',
    description: 'binary data with edge values',
  },
  {
    decoded: new Uint8Array([255, 255, 255]),
    encoded: '////',
    description: 'all max bytes',
  },
  {
    decoded: new Uint8Array([0, 0, 0]),
    encoded: 'AAAA',
    description: 'all zero bytes',
  },
  // ArrayBuffer test case
  {
    decoded: new Uint8Array([102, 111, 111]).buffer, // "foo"
    encoded: 'Zm9v',
    description: 'ArrayBuffer',
  },
]

fixtures.forEach((fixture) => {
  const isString = typeof fixture.decoded === 'string'
  const isArrayBuffer = fixture.decoded instanceof ArrayBuffer
  const isUint8Array = fixture.decoded instanceof Uint8Array

  test(`encodeBase64 - ${fixture.description}`, () => {
    const result = encodeBase64(fixture.decoded)

    assert({
      given: fixture.description,
      should: `encode to "${fixture.encoded}"`,
      actual: result,
      expected: fixture.encoded,
    })
  })

  if (fixture.encoded !== '') {
    test(`decodeBase64 - ${fixture.description}`, () => {
      const result = decodeBase64(fixture.encoded)

      if (isString) {
        const decoded = new TextDecoder().decode(result)
        assert({
          given: `base64 "${fixture.encoded}"`,
          should: `decode to "${fixture.decoded}"`,
          actual: decoded,
          expected: fixture.decoded,
        })
      } else {
        const expected = isArrayBuffer
          ? Array.from(new Uint8Array(fixture.decoded as ArrayBuffer))
          : Array.from(fixture.decoded as Uint8Array)

        assert({
          given: `base64 "${fixture.encoded}"`,
          should: 'decode to original bytes',
          actual: Array.from(result),
          expected,
        })
      }
    })
  } else {
    // Special case for empty string
    test(`decodeBase64 - ${fixture.description}`, () => {
      const result = decodeBase64(fixture.encoded)

      assert({
        given: `base64 "${fixture.encoded}"`,
        should: 'decode to empty Uint8Array',
        actual: result.length,
        expected: 0,
      })
    })
  }

  test(`roundtrip - ${fixture.description}`, () => {
    const encoded = encodeBase64(fixture.decoded)
    const decoded = decodeBase64(encoded)

    if (isString) {
      const result = new TextDecoder().decode(decoded)
      assert({
        given: fixture.description,
        should: 'survive encode/decode roundtrip',
        actual: result,
        expected: fixture.decoded,
      })
    } else {
      const expected = isArrayBuffer
        ? Array.from(new Uint8Array(fixture.decoded as ArrayBuffer))
        : Array.from(fixture.decoded as Uint8Array)

      assert({
        given: fixture.description,
        should: 'survive encode/decode roundtrip',
        actual: Array.from(decoded),
        expected,
      })
    }
  })
})
