import process from 'node:process'
import { runCommand } from '#lib/sys/mod.ts'
import type { SignInApproval } from './broker.ts'
import type { NativeAuthenticationApproval } from './nativeAuthentication.ts'

/** Metadata is untrusted too: no terminal/control/bidi tricks inside a native authorization dialog. */
export const approvalLabel = (value: string): string => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').slice(0, 160)

/** Native process output can contain login metadata; only this fixed error may leave the prompt. */
export class NativeApprovalError extends Error {
  constructor() {
    super('The native sign-in dialog could not complete.')
  }
}

async function runApproval(
  script: string,
  args: string[],
  seconds: number,
  signal: AbortSignal | undefined,
  execute: typeof runCommand,
): Promise<string> {
  if (signal?.aborted) return ''
  if (process.platform !== 'darwin') throw new NativeApprovalError()
  let result: Awaited<ReturnType<typeof runCommand>>
  try {
    result = await execute('/usr/bin/osascript', ['-e', script, ...args], {
      signal,
      timeout: (seconds + 5) * 1000,
      maxBuffer: 4096,
    })
  } catch {
    if (signal?.aborted) return ''
    throw new NativeApprovalError()
  }
  if (signal?.aborted) return ''
  if (result.success) return result.stdout.trim()
  // AppleScript reports an explicit Cancel as error -128. A script crash is not a cancellation.
  if (/\(-128\)\s*$/.test(result.stderr)) return ''
  throw new NativeApprovalError()
}

function dialogScript(body: string): string {
  // osascript launched by the service stays behind the browser unless it becomes an active UI app.
  return `use framework "AppKit"
use scripting additions
on run argv
  my activatePrompt()
  ${body}
end run
on activatePrompt()
  set promptApplication to current application's NSApplication's sharedApplication()
  promptApplication's setActivationPolicy:1
  promptApplication's activateIgnoringOtherApps:true
end activatePrompt`
}

const LOOKUP = dialogScript(`
  set reply to display dialog (item 1 of argv) with title "Sky browser sign-in" buttons {"Cancel", "Find login"} default button "Cancel" cancel button "Cancel" giving up after 120
  if gave up of reply then return ""
  return "allow"`)

const CHOOSE = dialogScript(`
  set choices to items 2 thru -1 of argv
  set picked to choose from list choices with title "Sky browser sign-in" with prompt (item 1 of argv) OK button name "Sign in" cancel button name "Cancel" without multiple selections allowed and empty selection allowed
  if picked is false then return ""
  repeat with i from 1 to count of choices
    if item i of choices is item 1 of picked then return i as string
  end repeat
  return ""`)

const SESSION = dialogScript(`
  set reply to display dialog (item 1 of argv) with title "Sky · 1Password for this run" buttons {"Cancel", "Allow this run"} default button "Cancel" cancel button "Cancel" giving up after 120
  if gave up of reply then return ""
  return "allow"`)

/** One grant for this worker's run; ambiguous logins still use the native chooser. */
export function nativeRunApproval(
  objective: string,
  signal?: AbortSignal,
  execute: typeof runCommand = runCommand,
): SignInApproval {
  return {
    ...nativeSignInApproval(objective, signal, execute),
    allowLookup: async (origin) => {
      const answer = await runApproval(
        SESSION,
        [
          `Allow Sky to use 1Password for this run?\n\n${approvalLabel(objective)}\n\nFirst website: ${origin}\n\nSky will use the unique matching login and its saved verification code at each website needed for this task. If multiple logins match, Sky will ask you to choose.\n\nAccess ends when you pause or finish the run. Website sign-ins stay in your browser. 1Password may also ask you to unlock or authorize each connected account.`,
        ],
        120,
        signal,
        execute,
      )
      if (answer && answer !== 'allow') throw new NativeApprovalError()
      return answer === 'allow'
    },
  }
}

/** This process owns the native prompt. There is deliberately no API to answer it. */
export function nativeSignInApproval(
  objective: string,
  signal?: AbortSignal,
  /** Local test seam, never accepted by the worker protocol or an HTTP request. */
  execute: typeof runCommand = runCommand,
): SignInApproval {
  const run = (script: string, args: string[]) => runApproval(script, args, 120, signal, execute)
  return {
    allowLookup: async (origin) => {
      const answer = await run(LOOKUP, [
        `Find a 1Password login for this website?\n\n${origin}\n\nTask: ${approvalLabel(objective)}\n\nYou will choose the login before Sky uses it.`,
      ])
      if (answer && answer !== 'allow') throw new NativeApprovalError()
      return answer === 'allow'
    },
    choose: async (origin, choices) => {
      const answer = await run(CHOOSE, [
        `Allow this browser task to sign in at:\n${origin}\n\nTask: ${approvalLabel(objective)}\n\nSky can use this login's password and, if needed, one verification code saved with it. Sky remembers the website session for future tasks until you sign out or the website expires it.`,
        ...choices.map(
          (choice, index) =>
            `${index + 1}. ${approvalLabel(choice.title)} — ${approvalLabel(choice.account)} — ${approvalLabel(choice.vault)}`,
        ),
      ])
      if (!answer) return null
      if (!/^\d+$/.test(answer) || Number(answer) < 1 || Number(answer) > choices.length)
        throw new NativeApprovalError()
      return Number(answer) - 1
    },
  }
}

export function nativeAuthenticationApproval(
  objective: string,
  signal?: AbortSignal,
  /** Local test seam, never accepted by the worker protocol or an HTTP request. */
  execute: typeof runCommand = runCommand,
): NativeAuthenticationApproval {
  const ask = async (message: string, buttons: string[], seconds = 120): Promise<string> => {
    // An AppleScript `if` clears implicit `result`; keep the dialog record for the button read.
    const script = dialogScript(`
      set reply to display dialog (item 1 of argv) with title "Sky private sign-in" buttons {${buttons.map((button) => JSON.stringify(button)).join(', ')}} default button "Cancel" cancel button "Cancel" giving up after ${seconds}
      if gave up of reply then return ""
      return button returned of reply`)
    const answer = await runApproval(script, [message], seconds, signal, execute)
    if (answer && !buttons.includes(answer)) throw new NativeApprovalError()
    return answer
  }
  const task = `\n\nTask: ${approvalLabel(objective)}`
  return {
    method: async (origin) => {
      const result = await ask(
        `How would you like to sign in at ${origin}?${task}\n\nUse the browser for Apple Passwords, passkeys, or SSO.`,
        ['Cancel', '1Password login', 'In browser'],
      )
      return result === '1Password login' ? 'password' : result === 'In browser' ? 'browser' : null
    },
    begin: async (origin) =>
      (await ask(
        `Allow this task to use your signed-in session at:\n${origin}${task}\n\nComplete sign-in in the browser using Apple Passwords, a passkey, or SSO. Credential entry stays private.`,
        ['Cancel', 'Continue'],
      )) === 'Continue',
    provider: async (origin, destination) =>
      (await ask(
        `Allow this sign-in to continue to:\n${destination}\n\nReturn website: ${origin}${task}\n\nOnly continue if you recognize this identity provider.`,
        ['Cancel', 'Continue'],
      )) === 'Continue',
    finish: async (origin) =>
      (await ask(
        `Finish signing in in the browser, then return here.\n\nAllow Sky to continue on ${origin}?\n\nUse the browser for passwords, Touch ID, passkeys, and verification codes. Never paste them into chat.`,
        ['Cancel', 'Continue Sky'],
        240,
      )) === 'Continue Sky',
  }
}
