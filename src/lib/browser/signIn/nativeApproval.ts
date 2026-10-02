import process from 'node:process'
import { runCommand } from '#lib/sys/mod.ts'
import type { SignInApproval } from './broker.ts'
import type { NativeAuthenticationApproval } from './nativeAuthentication.ts'

/** Metadata is untrusted too: no terminal/control/bidi tricks inside a native authorization dialog. */
export const approvalLabel = (value: string): string => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').slice(0, 160)

const LOOKUP = `on run argv
  display dialog (item 1 of argv) with title "Sky browser sign-in" buttons {"Cancel", "Find login"} default button "Cancel" cancel button "Cancel" giving up after 120
  if gave up of result then return ""
  return "allow"
end run`

const CHOOSE = `on run argv
  set choices to items 2 thru -1 of argv
  set picked to choose from list choices with title "Sky browser sign-in" with prompt (item 1 of argv) OK button name "Sign in" cancel button name "Cancel" without multiple selections allowed and empty selection allowed
  if picked is false then return ""
  repeat with i from 1 to count of choices
    if item i of choices is item 1 of picked then return i as string
  end repeat
  return ""
end run`

/** This process owns the native prompt. There is deliberately no API to answer it. */
export function nativeSignInApproval(objective: string, signal?: AbortSignal): SignInApproval {
  const run = async (script: string, args: string[]) => {
    if (process.platform !== 'darwin' || signal?.aborted) return ''
    const result = await runCommand('/usr/bin/osascript', ['-e', script, ...args], {
      signal,
      timeout: 120_000,
      maxBuffer: 4096,
    })
    return result.success ? result.stdout.trim() : ''
  }
  return {
    allowLookup: async (origin) =>
      (await run(LOOKUP, [
        `Find a 1Password login for this website?\n\n${origin}\n\nTask: ${approvalLabel(objective)}\n\nYou will choose the login before Sky uses it.`,
      ])) === 'allow',
    choose: async (origin, choices) => {
      const answer = await run(CHOOSE, [
        `Allow this browser task to sign in at:\n${origin}\n\nTask: ${approvalLabel(objective)}\n\nSky can use this login's password and, if needed, one verification code saved with it. The login and signed-in session are used only for this task.`,
        ...choices.map(
          (choice, index) =>
            `${index + 1}. ${approvalLabel(choice.title)} — ${approvalLabel(choice.account)} — ${approvalLabel(choice.vault)}`,
        ),
      ])
      return /^\d+$/.test(answer) ? Number(answer) - 1 : null
    },
  }
}

export function nativeAuthenticationApproval(objective: string, signal?: AbortSignal): NativeAuthenticationApproval {
  const ask = async (message: string, buttons: string[], seconds = 120): Promise<string> => {
    if (process.platform !== 'darwin' || signal?.aborted) return ''
    const script = `on run argv
      display dialog (item 1 of argv) with title "Sky private sign-in" buttons {${buttons.map((button) => JSON.stringify(button)).join(', ')}} default button "Cancel" cancel button "Cancel" giving up after ${seconds}
      if gave up of result then return ""
      return button returned of result
    end run`
    const result = await runCommand('/usr/bin/osascript', ['-e', script, message], {
      signal,
      timeout: (seconds + 5) * 1000,
      maxBuffer: 4096,
    })
    return result.success ? result.stdout.trim() : ''
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
