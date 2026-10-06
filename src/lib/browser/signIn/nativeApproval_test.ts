import process from 'node:process'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'
import {
  NativeApprovalError,
  nativeAuthenticationApproval,
  nativeRunApproval,
  nativeSignInApproval,
} from './nativeApproval.ts'

const macOnly = { ignore: process.platform !== 'darwin' }
const origin = 'https://atlas.example'

/** Run the production AppleScript with synthetic UI responses and no foreground activation or vault access. */
function dialogReply(body: string): typeof runCommand {
  return async (command, args = [], options) => {
    const script = args[1]
    const substituted = script
      .replace('my activatePrompt()', '')
      .replace(/(?:display dialog|choose from list) [^\n]+/, 'my syntheticReply(argv)')
    if (substituted === script || /display dialog|choose from list/.test(substituted))
      throw new Error('The synthetic dialog must replace the entire native UI command')
    return runCommand(
      command,
      [args[0], `${substituted}\non syntheticReply(argv)\n${body}\nend syntheticReply`, ...args.slice(2)],
      options,
    )
  }
}

const clicked = (button: string, expired = false) =>
  dialogReply(`return {button returned:${JSON.stringify(button)}, gave up:${expired}}`)

test('native button responses survive AppleScript control flow', macOnly, async () => {
  const auth = (button: string) => nativeAuthenticationApproval('Read an Atlas statement', undefined, clicked(button))
  assert({
    given: 'each button returned by the native dialog, interpreted by macOS',
    should: 'preserve the selected method and each explicit continuation',
    actual: [
      await auth('1Password login').method(origin),
      await auth('In browser').method(origin),
      await auth('Continue').begin(origin),
      await auth('Continue').provider(origin, 'https://identity.example'),
      await auth('Continue Sky').finish(origin),
      await nativeSignInApproval('Read an Atlas statement', undefined, clicked('Find login')).allowLookup(origin),
      await nativeRunApproval('Collect Atlas documents', undefined, clicked('Allow this run')).allowLookup(origin),
    ],
    expected: ['password', 'browser', true, true, true, true, true],
  })

  const approval = nativeSignInApproval('Read an Atlas statement', undefined, dialogReply('return {item 3 of argv}'))
  assert({
    given: 'a selection from the actual numbered list passed as arguments',
    should: 'return the selected login index',
    actual: await approval.choose(origin, [
      { title: 'Atlas', account: 'Example account', vault: 'Personal' },
      { title: 'Atlas "Secondary"', account: 'Example account', vault: 'Shared' },
    ]),
    expected: 1,
  })
})

test('cancelled and expired native dialogs grant no approval', macOnly, async () => {
  const cancel = dialogReply('error "User canceled." number -128')
  const expired = clicked('1Password login', true)
  assert({
    given: 'AppleScript cancellation, dialog expiry, and a cancelled list selection',
    should: 'decline without confusing cancellation with a script failure',
    actual: [
      await nativeAuthenticationApproval('Atlas task', undefined, cancel).method(origin),
      await nativeAuthenticationApproval('Atlas task', undefined, expired).method(origin),
      await nativeSignInApproval('Atlas task', undefined, cancel).allowLookup(origin),
      await nativeSignInApproval('Atlas task', undefined, expired).allowLookup(origin),
      await nativeRunApproval('Atlas task', undefined, cancel).allowLookup(origin),
      await nativeRunApproval('Atlas task', undefined, expired).allowLookup(origin),
      await nativeSignInApproval('Atlas task', undefined, dialogReply('return false')).choose(origin, [
        { title: 'Atlas', account: 'Example account', vault: 'Personal' },
      ]),
    ],
    expected: [null, null, false, false, false, false, null],
  })
})

test(
  'native script and process failures are distinct from cancellation without exposing their output',
  macOnly,
  async () => {
    const crash = dialogReply('error "synthetic-private-metadata" number -2753')
    const failure = async (work: () => Promise<unknown>) => {
      try {
        await work()
        return null
      } catch (error) {
        return [error instanceof NativeApprovalError, (error as Error).message]
      }
    }
    const unavailable: typeof runCommand = async () => {
      throw new Error('synthetic-private-metadata')
    }
    const results = await Promise.all([
      failure(() => nativeAuthenticationApproval('Atlas task', undefined, crash).method(origin)),
      failure(() => nativeSignInApproval('Atlas task', undefined, crash).allowLookup(origin)),
      failure(() => nativeSignInApproval('Atlas task', undefined, crash).choose(origin, [])),
      failure(() => nativeAuthenticationApproval('Atlas task', undefined, unavailable).method(origin)),
      failure(() => nativeAuthenticationApproval('Atlas task', undefined, clicked('Unknown response')).method(origin)),
    ])
    assert({
      given: 'script errors, a failed process launch, and an unexpected dialog response',
      should: 'report only the fixed native dialog error',
      actual: results,
      expected: Array(5).fill([true, 'The native sign-in dialog could not complete.']),
    })
  },
)

test('aborting a native prompt cannot grant approval or become a dialog crash', macOnly, async () => {
  const controller = new AbortController()
  let calls = 0
  const execute: typeof runCommand = async () => {
    calls++
    controller.abort()
    return { success: true, code: 0, stdout: '1Password login', stderr: '' }
  }
  const approval = nativeAuthenticationApproval('Atlas task', controller.signal, execute)
  assert({
    given: 'an abort during the prompt and a subsequent attempt',
    should: 'discard the reply and never reopen a dialog after cancellation',
    actual: [await approval.method(origin), await approval.method(origin), calls],
    expected: [null, null, 1],
  })
})
