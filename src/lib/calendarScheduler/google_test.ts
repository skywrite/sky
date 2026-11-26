import { CALENDAR_READONLY_SCOPE, saveAccountTokens } from '#lib/google/mod.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { createGoogleCalendarHost } from './google.ts'

test('createGoogleCalendarHost setup returns defaultAccount when one Professional calendar account exists', async () => {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'work@example.com', {
    refreshToken: 'refresh-work',
    scopes: [CALENDAR_READONLY_SCOPE],
  })
  await saveAccountTokens(secrets, 'personal@example.com', {
    refreshToken: 'refresh-personal',
    scopes: [CALENDAR_READONLY_SCOPE],
  })
  const oneWork = createGoogleCalendarHost({
    dir: '/tmp/sky-calendar-host-test',
    secrets,
    people: async () => [],
    categoryOf: (email) => (email === 'personal@example.com' ? 'Personal' : 'Professional'),
  })
  const twoWork = createGoogleCalendarHost({
    dir: '/tmp/sky-calendar-host-test',
    secrets,
    people: async () => [],
    categoryOf: () => 'Professional',
  })
  const single = await oneWork.setup()
  const ambiguous = await twoWork.setup()
  assert({
    given: 'two calendar accounts with one Professional vs two Professional accounts',
    should: 'return defaultAccount only when one Professional account stands out',
    actual: [
      single.accounts.toSorted(),
      single.defaultAccount,
      ambiguous.accounts.toSorted(),
      ambiguous.defaultAccount,
    ],
    expected: [
      ['personal@example.com', 'work@example.com'],
      'work@example.com',
      ['personal@example.com', 'work@example.com'],
      undefined,
    ],
  })
})
