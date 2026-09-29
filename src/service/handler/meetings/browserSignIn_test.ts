import { assert, test } from '#test'
import { CalendarBrowserConnection } from './browserSignIn.ts'

test('calendar sign-in owns one window and stale checks cannot overwrite its status', async () => {
  const checked = Promise.withResolvers<boolean>()
  const signed = Promise.withResolvers<void>()
  let windows = 0
  let holds = 0
  let releases = 0
  const connection = new CalendarBrowserConnection(
    {
      check: () => checked.promise,
      signIn: async (_account, _signal, opened) => {
        windows++
        opened()
        await signed.promise
      },
    },
    () => {
      holds++
      return () => {
        releases++
      }
    },
  )
  const account = 'organizer@example.com'
  const before = connection.status(account)
  connection.signIn(account)
  connection.signIn(account)
  const busy = connection.signIn('other@example.com')
  checked.resolve(false)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert({
    given: 'an unfinished check, two sign-in clicks, another account and a late signed-out check result',
    should: 'open once and preserve the active sign-in across status reads and page reloads',
    actual: [before.state, connection.status(account).state, busy.state, windows, holds, releases],
    expected: ['checking', 'waiting', 'busy', 1, 2, 1],
  })
  signed.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert({
    given: 'the selected account verified by the browser',
    should: 'report ready and release the service hold without a calendar write',
    actual: [connection.status(account).state, windows, holds, releases],
    expected: ['signed_in', 1, 2, 2],
  })
})

test('cancelled or failed browser sign-in never reports a connected account', async () => {
  let complete!: () => void
  let aborted = false
  let fail = false
  const connection = new CalendarBrowserConnection(
    {
      check: async () => false,
      signIn: async (_account, signal, opened) => {
        if (fail) throw new Error('The sign-in window was closed.')
        opened()
        signal.addEventListener('abort', () => {
          aborted = true
        })
        await new Promise<void>((resolve) => {
          complete = resolve
        })
      },
    },
    () => () => {},
  )
  const account = 'organizer@example.com'
  connection.signIn(account)
  const cancel = connection.cancel(account)
  complete()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const cancelled = connection.status(account)
  fail = true
  connection.signIn(account)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const failure = connection.status(account)
  assert({
    given: 'Cancel followed by a late completion, then a closed sign-in window on another attempt',
    should: 'preserve cancellation and offer recovery instead of accepting an unverified session',
    actual: [aborted, cancel.state, cancelled.state, failure.state, failure.message],
    expected: [true, 'sign_in_required', 'sign_in_required', 'failed', 'The sign-in window was closed.'],
  })
})
