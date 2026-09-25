import { assert, test } from '#test'
import { isLocalRequest, type RequestSource } from './localRequest.ts'

const SKY = 'http://127.0.0.1:9999'
const OTHER_SITE = 'https://example.com'

test('a request is local when addressed to this Mac by name and not marked as another site', () => {
  const cases: Array<[given: string, source: RequestSource, expected: boolean]> = [
    ['a program on this Mac', { url: `${SKY}/graphql`, method: 'POST' }, true],
    ['a program using localhost', { url: 'http://localhost:9999/graphql', method: 'GET' }, true],
    ['a program using the IPv6 loopback', { url: 'http://[::1]:9999/graphql', method: 'GET' }, true],
    [
      'a Sky page saving',
      { url: `${SKY}/docs/_api/content/a.md`, method: 'PUT', origin: SKY, site: 'same-origin', mode: 'cors' },
      true,
    ],
    [
      'an address typed into the browser',
      { url: `${SKY}/day`, method: 'GET', site: 'none', mode: 'navigate', dest: 'document' },
      true,
    ],
    [
      'a link on another site',
      { url: `${SKY}/day`, method: 'GET', site: 'cross-site', mode: 'navigate', dest: 'document' },
      true,
    ],
    [
      'a page on another site reading',
      { url: `${SKY}/graphql`, method: 'GET', origin: OTHER_SITE, site: 'cross-site', mode: 'cors' },
      false,
    ],
    [
      'a page on another site posting without an origin',
      { url: `${SKY}/chat`, method: 'POST', site: 'cross-site', mode: 'no-cors', dest: 'empty' },
      false,
    ],
    [
      'a form on another site',
      {
        url: `${SKY}/chat`,
        method: 'POST',
        origin: OTHER_SITE,
        site: 'cross-site',
        mode: 'navigate',
        dest: 'document',
      },
      false,
    ],
    [
      'another site framing a page',
      { url: `${SKY}/day`, method: 'GET', site: 'cross-site', mode: 'navigate', dest: 'iframe' },
      false,
    ],
    [
      'a page on another port of this Mac',
      { url: `${SKY}/graphql`, method: 'POST', origin: 'http://127.0.0.1:8123', site: 'same-site', mode: 'cors' },
      false,
    ],
    [
      'a request addressed to another name',
      { url: 'http://example.com:9999/graphql', method: 'GET', origin: 'http://example.com:9999', site: 'same-origin' },
      false,
    ],
    ['a sandboxed page', { url: `${SKY}/graphql`, method: 'POST', origin: 'null', site: 'cross-site' }, false],
    ['an unreadable address', { url: 'http://exa mple/graphql', method: 'GET' }, false],
  ]
  for (const [given, source, expected] of cases)
    assert({
      given,
      should: expected ? 'let it through' : 'refuse it',
      actual: isLocalRequest(source),
      expected,
    })
})
