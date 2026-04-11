import { assert, test } from '#test'
import { normalizeUrl } from './normalize.ts'

const fixtures = [
  {
    input: 'google.com',
    expected: 'https://google.com',
    description: 'bare domain without protocol',
  },
  {
    input: 'google.com/',
    expected: 'https://google.com',
    description: 'domain with trailing slash',
  },
  {
    input: 'https://example.com',
    expected: 'https://example.com',
    description: 'full URL with https',
  },
  {
    input: 'https://example.com/',
    expected: 'https://example.com',
    description: 'full URL with trailing slash',
  },
  {
    input: 'example.com/about',
    expected: 'https://example.com/about',
    description: 'URL with path',
  },
  {
    input: 'example.com/about/',
    expected: 'https://example.com/about',
    description: 'URL with path and trailing slash',
  },
  {
    input: 'example.com?foo=bar',
    expected: 'https://example.com?foo=bar',
    description: 'URL with query string',
  },
  {
    input: 'example.com#section',
    expected: 'https://example.com#section',
    description: 'URL with hash',
  },
  {
    input: 'http://example.com',
    expected: 'http://example.com',
    description: 'URL with http protocol',
  },
]

fixtures.forEach((fixture) => {
  test(`normalizeUrl - ${fixture.description}`, () => {
    assert({
      given: fixture.description,
      should: `normalize to ${fixture.expected}`,
      actual: normalizeUrl(fixture.input),
      expected: fixture.expected,
    })
  })
})
