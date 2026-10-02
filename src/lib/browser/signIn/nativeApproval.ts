import process from 'node:process'
import { runCommand } from '#lib/sys/mod.ts'
import type { SignInApproval } from './broker.ts'

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
