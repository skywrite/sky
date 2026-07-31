import { assert, test } from '#test'
import { AccountResolutionError, AmbiguousAccountError, resolveAccountEmail } from './accounts.ts'

const STORED = ['jane@example.com', 'jane@corp-mail.com']

function resolveError(options: Parameters<typeof resolveAccountEmail>[0]): Error | undefined {
  try {
    resolveAccountEmail(options)
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
