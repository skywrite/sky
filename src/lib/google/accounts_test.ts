import { assert, test } from '#test'
import {
  AccountResolutionError,
  AmbiguousAccountError,
  accountLookupOrder,
  accountOrg,
  defaultAccountEmail,
  resolveAccountEmail,
  resolveNewItemAccountEmail,
} from './accounts.ts'

const STORED = ['jane@example.com', 'jane@corp-mail.com']

/** Sides as the Google settings page would hold them: the named accounts are personal, the rest work. */
const personal =
  (...emails: string[]) =>
  (email: string) =>
    emails.includes(email) ? ('Personal' as const) : ('Professional' as const)

function resolveError(options: Parameters<typeof resolveAccountEmail>[0]): Error | undefined {
  try {
    resolveAccountEmail(options)
    return undefined
  } catch (err) {
    return err as Error
  }
}

/** What a call throws, or undefined when it returns. */
function thrown(run: () => unknown): Error | undefined {
  try {
    run()
    return undefined
  } catch (err) {
    return err as Error
  }
}

test('resolveAccountEmail', () => {
  assert({
    given: 'a single stored account and no request',
    should: 'pick it',
    expected: 'jane@example.com',
    actual: resolveAccountEmail({ stored: ['jane@example.com'] }),
  })

  assert({
    given: 'an exact email request',
    should: 'match it',
    expected: 'jane@corp-mail.com',
    actual: resolveAccountEmail({ requested: 'jane@corp-mail.com', stored: STORED }),
  })

  assert({
    given: 'a unique substring request',
    should: 'match case-insensitively',
    expected: 'jane@corp-mail.com',
    actual: resolveAccountEmail({ requested: 'CORP', stored: STORED }),
  })
})

test('resolveAccountEmail failures', () => {
  assert({
    given: 'no stored accounts',
    should: 'point at sky google:auth',
    expected: true,
    actual: resolveError({ stored: [] })?.message.includes('google:auth') ?? false,
  })

  const ambiguousNoRequest = resolveError({ stored: STORED })
  assert({
    given: 'two accounts and no request',
    should: 'throw AmbiguousAccountError listing both candidates',
    expected: ['AmbiguousAccountError', STORED],
    actual: [ambiguousNoRequest?.name, (ambiguousNoRequest as AmbiguousAccountError)?.candidates],
  })

  const ambiguousSubstring = resolveError({ requested: 'jane', stored: STORED })
  assert({
    given: 'a substring matching both accounts',
    should: 'throw AmbiguousAccountError',
    expected: 'AmbiguousAccountError',
    actual: ambiguousSubstring?.name,
  })

  const noMatch = resolveError({ requested: 'nobody', stored: STORED })
  assert({
    given: 'a substring matching nothing',
    should: 'throw a plain resolution error naming the accounts',
    expected: [true, true],
    actual: [noMatch instanceof AccountResolutionError, noMatch?.message.includes('jane@example.com') ?? false],
  })
})

test('the account something new comes from is the work account, and only an open choice asks', () => {
  assert({
    given: 'one account, a work and a personal account, two work accounts, two personal accounts, and none',
    should: 'pick the only account or the only work account, and nothing when the choice is open',
    expected: ['jane@example.com', 'jane@corp-mail.com', undefined, undefined, undefined],
    actual: [
      defaultAccountEmail(['jane@example.com'], personal('jane@example.com')),
      defaultAccountEmail(STORED, personal('jane@example.com')),
      defaultAccountEmail(STORED, personal()),
      defaultAccountEmail(STORED, personal(...STORED)),
      defaultAccountEmail([], personal()),
    ],
  })

  assert({
    given: 'a work and a personal account',
    should: 'use the work account when none is named and the named one when it is',
    expected: ['jane@corp-mail.com', 'jane@example.com'],
    actual: [
      resolveNewItemAccountEmail({ stored: STORED, categoryOf: personal('jane@example.com') }),
      resolveNewItemAccountEmail({ requested: 'example', stored: STORED, categoryOf: personal('jane@example.com') }),
    ],
  })

  const open = thrown(() => resolveNewItemAccountEmail({ stored: STORED, categoryOf: personal() }))
  const none = thrown(() => resolveNewItemAccountEmail({ stored: [], categoryOf: personal() }))
  assert({
    given: 'two work accounts and no account named, and no accounts at all',
    should: 'leave the choice open with both candidates, and point at sky google:auth',
    expected: ['AmbiguousAccountError', STORED, true],
    actual: [open?.name, (open as AmbiguousAccountError)?.candidates, none?.message.includes('google:auth') ?? false],
  })
})

test('a lookup tries the named account, then the work account, then the rest', () => {
  const three = ['alex@example.com', 'jane@corp-mail.com', 'jane@example.com']
  const sides = personal('alex@example.com', 'jane@example.com')
  assert({
    given: 'two personal accounts and a work account, with and without an account named',
    should: 'put the named account first, the work account next, and never drop an account',
    expected: [
      ['jane@corp-mail.com', 'alex@example.com', 'jane@example.com'],
      ['alex@example.com', 'jane@corp-mail.com', 'jane@example.com'],
    ],
    actual: [
      accountLookupOrder({ stored: three, categoryOf: sides }),
      accountLookupOrder({ requested: 'alex', stored: three, categoryOf: sides }),
    ],
  })

  assert({
    given: 'two work accounts, where nothing says which comes first',
    should: 'keep them as stored',
    expected: STORED,
    actual: accountLookupOrder({ stored: STORED, categoryOf: personal() }),
  })

  assert({
    given: 'a named account that is not connected, and no accounts at all',
    should: 'fail as an explicit request does everywhere else',
    expected: [true, true],
    actual: [
      thrown(() => accountLookupOrder({ requested: 'nobody', stored: three, categoryOf: sides })) instanceof
        AccountResolutionError,
      thrown(() => accountLookupOrder({ stored: [], categoryOf: sides }))?.message.includes('google:auth') ?? false,
    ],
  })
})

test('an account belongs to the organization whose website shares its email domain', () => {
  const orgs = [
    { name: 'Atlas', sites: ['https://www.atlas.example/', 'https://atlas-labs.example'] },
    { name: 'Cedar Foundation', sites: ['https://cedar.example/about', 'https://www.linkedin.com/company/cedar'] },
    { name: 'LinkedIn', sites: ['https://www.linkedin.com'] },
  ]
  assert({
    given: "accounts on an organization's first and second domain, on a subdomain of it, and on a public mail host",
    should: 'name the organization for its own domains and nobody for the public one',
    expected: ['Atlas', 'Atlas', 'Atlas', undefined],
    actual: [
      accountOrg('jane@atlas.example', orgs),
      accountOrg('Jane@Atlas-Labs.example', orgs),
      accountOrg('jane@mail.atlas.example', orgs),
      accountOrg('jane@example.com', orgs),
    ],
  })

  assert({
    given: "an organization known only by a page inside its site, and one whose profile page is on another's site",
    should: 'count home pages alone, so a LinkedIn page claims nothing',
    expected: [undefined, 'LinkedIn'],
    actual: [accountOrg('sam@cedar.example', orgs), accountOrg('alex@linkedin.com', orgs)],
  })

  assert({
    given: 'two organizations whose websites share the domain',
    should: 'name neither',
    expected: undefined,
    actual: accountOrg('jane@atlas.example', [...orgs, { name: 'Atlas Holdings', sites: ['atlas.example'] }]),
  })
})
