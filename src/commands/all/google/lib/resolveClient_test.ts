import { AccountResolutionError, AmbiguousAccountError, GoogleApiError } from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'
import { saveAccountTokens, saveOAuthClient } from '#lib/google/tokens.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { accountSwitchNote, findOwningGoogleClient, resolveGoogleClientForNew } from './resolveClient.ts'

const WORK = 'jane@atlas.example'
const HOME = 'jane@example.com'

/** A keychain holding the given accounts, all granted through one shared client pair. */
async function keychain(...emails: string[]): Promise<TestSecretsProvider> {
  const secrets = new TestSecretsProvider()
  await saveOAuthClient(secrets, { clientId: 'id', clientSecret: 'secret' })
  for (const email of emails) await saveAccountTokens(secrets, email, { refreshToken: 'rt', scopes: [] })
  return secrets
}

/** The named accounts are personal, every other account work — as the Google settings page would hold them. */
const personal =
  (...emails: string[]) =>
  (email: string) =>
    emails.includes(email) ? ('Personal' as const) : ('Professional' as const)

async function thrown(run: () => Promise<unknown>): Promise<Error | undefined> {
  try {
    await run()
    return undefined
  } catch (err) {
    return err as Error
  }
}

test('something new is made in the work account unless another is named', async () => {
  const secrets = await keychain(HOME, WORK)
  const forNew = (requested?: string) =>
    resolveGoogleClientForNew({ secrets, requested, interactive: false, categoryOf: personal(HOME) })
  assert({
    given: 'a work and a personal account, with no account named and with the personal one named by a part of it',
    should: 'use the work account, and the named one when asked',
    expected: [WORK, HOME],
    actual: [(await forNew()).email, (await forNew('example.com')).email],
  })

  const open = await thrown(() => resolveGoogleClientForNew({ secrets, interactive: false, categoryOf: personal() }))
  assert({
    given: 'two work accounts, no account named, and nobody to ask',
    should: 'fail with both as the choices instead of guessing',
    expected: [true, [WORK, HOME]],
    actual: [open instanceof AmbiguousAccountError, (open as AmbiguousAccountError | undefined)?.candidates],
  })
})

test('something that exists is opened by whichever account holds it', async () => {
  const secrets = await keychain(HOME, WORK)
  const tried: string[] = []
  /** A file only `holder` can open: every other account gets Drive's 404. */
  const heldBy = (holder: string) => async (client: GoogleClient) => {
    tried.push(client.email)
    if (client.email !== holder) throw new GoogleApiError(404, 'https://example.com/file')
    return `opened as ${client.email}`
  }
  const find = (holder: string, requested?: string) => {
    tried.length = 0
    return findOwningGoogleClient({
      secrets,
      requested,
      what: 'The file abc',
      attempt: heldBy(holder),
      categoryOf: personal(HOME),
    })
  }

  const atWork = await find(WORK)
  assert({
    given: 'a file the work account holds and no account named',
    should: 'open it on the first try, with nothing to note',
    expected: [WORK, 'opened as jane@atlas.example', [WORK], undefined],
    actual: [atWork.client.email, atWork.value, [...tried], accountSwitchNote(atWork)],
  })

  const atHome = await find(HOME)
  assert({
    given: 'a file only the personal account holds',
    should: 'fall through to it after the work account, and say so',
    expected: [HOME, [WORK, HOME], 'jane@atlas.example could not open it; used jane@example.com.'],
    actual: [atHome.client.email, [...tried], accountSwitchNote(atHome)],
  })

  const wrongGuess = await find(WORK, 'example.com')
  assert({
    given: 'the personal account named for a file the work account holds',
    should: 'try the named account first and still open the file from the one that holds it',
    expected: [WORK, [HOME, WORK]],
    actual: [wrongGuess.client.email, [...tried]],
  })

  const nowhere = await thrown(() => find('nobody@example.com'))
  assert({
    given: 'a file no connected account holds',
    should: 'fail naming the file and every account looked in',
    expected: [true, true],
    actual: [
      nowhere instanceof AccountResolutionError,
      ['The file abc', WORK, HOME].every((part) => nowhere?.message.includes(part)),
    ],
  })
})

test('an account that cannot be asked never hides the one that can answer', async () => {
  const secrets = await keychain(HOME, WORK)
  const refusing = (holder?: string) =>
    findOwningGoogleClient({
      secrets,
      what: 'The file abc',
      categoryOf: personal(HOME),
      attempt: async (client) => {
        if (client.email === WORK) throw new GoogleApiError(403, 'https://example.com/file', 'insufficient permission')
        if (client.email !== holder) throw new GoogleApiError(404, 'https://example.com/file')
        return client.email
      },
    })

  const found = await refusing(HOME)
  assert({
    given: 'a work account Google refuses and a personal account that holds the file',
    should: 'open it from the personal account',
    expected: [HOME, [WORK]],
    actual: [found.value, found.passed],
  })

  const refused = await thrown(() => refusing())
  assert({
    given: 'the same refusal when no account holds the file',
    should: 'report the refusal, which says more than "not found"',
    expected: [true, 403],
    actual: [refused instanceof GoogleApiError, (refused as GoogleApiError | undefined)?.status],
  })
})
