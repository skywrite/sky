import { assert, test } from '#test'
import { matchesLoginOrigin, sameLoginWebsite, secureOrigin } from './login.ts'
import type { CredentialSummary } from './types.ts'

test('saved login matching follows exact, website-wide and never-fill preferences', () => {
  const item: CredentialSummary = {
    ref: { connectionId: 'mock', containerId: 'vault', itemId: 'login' },
    title: 'Atlas',
    nativeCategory: 'Login',
    tags: [],
    websites: [{ url: 'https://www.atlas.example/login', match: 'exact' }],
  }
  const origins = ['https://www.atlas.example', 'https://login.atlas.example', 'https://atlas.example']
  for (const match of ['exact', 'subdomains', 'never'] as const) {
    item.websites[0].match = match
    assert({
      given: `a saved website with ${match} autofill`,
      should: 'use the configured host scope at credential consumption',
      actual: origins.map((origin) => matchesLoginOrigin(item, origin)),
      expected:
        match === 'exact' ? [true, false, false] : match === 'subdomains' ? [true, true, true] : [false, false, false],
    })
  }
})

test('website-wide matching respects public and private suffix boundaries and HTTPS ports', () => {
  const pairs = [
    ['https://www.atlas.co.uk', 'https://login.atlas.co.uk'],
    ['https://www.atlas.co.uk', 'https://other.co.uk'],
    ['https://atlas.example', 'https://atlas.example.evil.test'],
    ['https://tenant-a.github.io', 'https://tenant-b.github.io'],
    ['https://atlas.example', 'http://atlas.example'],
    ['https://atlas.example', 'https://login.atlas.example:444'],
    ['https://atlas.example', 'https://user@atlas.example'],
    ['https://co.uk', 'https://another.co.uk'],
  ]
  assert({
    given: 'shared suffixes, lookalikes and different transport origins',
    should: 'match only subdomains of the same HTTPS website and port',
    actual: pairs.map(([a, b]) => sameLoginWebsite(a, b)),
    expected: [true, false, false, false, false, false, false, false],
  })
})

test('scheme-less saved websites match HTTPS logins without relaxing page or autofill boundaries', () => {
  const item: CredentialSummary = {
    ref: { connectionId: 'mock', containerId: 'vault', itemId: 'login' },
    title: 'Atlas',
    nativeCategory: 'Login',
    tags: [],
    websites: [],
  }
  const cases: [string, string, 'exact' | 'subdomains' | 'never', boolean][] = [
    ['atlas.example', 'https://atlas.example', 'exact', true],
    [' ATLAS.example/login ', 'https://atlas.example', 'exact', true],
    ['atlas.example:8443/login', 'https://atlas.example:8443', 'exact', true],
    ['www.atlas.example/login', 'https://api.atlas.example', 'subdomains', true],
    ['www.atlas.example', 'https://atlas.example', 'exact', false],
    ['atlas.example', 'https://atlas.example', 'never', false],
    ['atlas.example', 'http://atlas.example', 'subdomains', false],
    ['atlas.example', 'atlas.example', 'subdomains', false],
    ['atlas.example', 'https://atlas.example/login', 'subdomains', false],
    ['atlas.example', 'https://atlas.example:444', 'subdomains', false],
    ['atlas.example', 'https://atlas.example.evil.test', 'subdomains', false],
    ['tenant-a.github.io', 'https://tenant-b.github.io', 'subdomains', false],
    ['http://atlas.example', 'https://atlas.example', 'subdomains', false],
    ['ftp://atlas.example', 'https://atlas.example', 'subdomains', false],
    ['javascript:atlas.example', 'https://atlas.example', 'subdomains', false],
    ['user@atlas.example', 'https://atlas.example', 'subdomains', false],
    ['//atlas.example', 'https://atlas.example', 'subdomains', false],
    ['/atlas.example', 'https://atlas.example', 'subdomains', false],
    ['atlas.\nexample', 'https://atlas.example', 'subdomains', false],
    ['atlas.example\\login', 'https://atlas.example', 'subdomains', false],
    ['', 'https://atlas.example', 'subdomains', false],
  ]
  for (const [url, origin, match, expected] of cases) {
    item.websites = [{ url, match }]
    assert({
      given: `${JSON.stringify(url)} saved with ${match} matching and target ${origin}`,
      should: 'normalize only saved website metadata and preserve the configured scope',
      actual: matchesLoginOrigin(item, origin),
      expected,
    })
  }
  assert({
    given: 'a scheme-less live page or API origin',
    should: 'still require an explicit HTTPS origin',
    actual: [secureOrigin('atlas.example'), sameLoginWebsite('atlas.example', 'https://atlas.example')],
    expected: [null, false],
  })
})
