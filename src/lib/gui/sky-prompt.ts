import { runCommand } from '#lib/sys/mod.ts'

/**
 * Asks a question in a small native macOS dialog and reports what the person
 * typed and which button they clicked. The dialog is `gui-prompt`
 * (https://github.com/skywrite/gui-prompt): OK and Cancel on the right, up to
 * three optional action buttons on the left, numbered left to right. It exits 0
 * whatever was clicked and prints one line — `OK: <text>`, `CANCEL: <text>` or
 * `ACTION<N>: <text>`. The action buttons are labels only; what one does is the
 * caller's business.
 */

/** The dialog binary, looked up on PATH. */
export const GUI_PROMPT = 'gui-prompt'

/** Where to get it, for the message when it is missing. */
export const GUI_PROMPT_INSTALL =
  'Install it from https://github.com/skywrite/gui-prompt: clone the repo and run its install.sh with a directory on your PATH.'

export enum SkyPromptStatus {
  Error,
  Cancel,
  Ok,
  Action1,
  Action2,
  Action3,
}

export type SkyPromptResponse = {
  status: SkyPromptStatus
  answer: string
}

export interface SkyPromptOptions {
  question?: string
  defaultAnswer?: string
  selectRange?: { start: number; length: number }
  /** Left-most action button */
  action1?: string
  action2?: string
  /** Right of the second action button */
  action3?: string
}

/** The dialog's command line: one flag per option, actions numbered so a missing one leaves the others in place. */
export function promptArgs(opts: SkyPromptOptions): string[] {
  const args: string[] = []

  if (opts.question) {
    args.push('-q', opts.question)
  }
  if (opts.defaultAnswer) {
    args.push('-d', opts.defaultAnswer)
  }
  if (opts.selectRange) {
    args.push('-s', `${opts.selectRange.start}:${opts.selectRange.length}`)
  }
  if (opts.action1) {
    args.push('-a1', opts.action1)
  }
  if (opts.action2) {
    args.push('-a2', opts.action2)
  }
  if (opts.action3) {
    args.push('-a3', opts.action3)
  }

  return args
}

/** Reads the dialog's one output line. A non-zero exit or an unknown status word is an error. */
export function parsePromptOutput(code: number, output: string): SkyPromptResponse {
  if (code !== 0) return { status: SkyPromptStatus.Error, answer: '' }

  const colonIndex = output.indexOf(': ')
  const statusText = colonIndex >= 0 ? output.slice(0, colonIndex) : output.trim()
  const answer = colonIndex >= 0 ? output.slice(colonIndex + 2).trim() : ''

  let status: SkyPromptStatus
  switch (statusText) {
    case 'OK':
      status = SkyPromptStatus.Ok
      break
    case 'CANCEL':
      status = SkyPromptStatus.Cancel
      break
    case 'ACTION1':
      status = SkyPromptStatus.Action1
      break
    case 'ACTION2':
      status = SkyPromptStatus.Action2
      break
    case 'ACTION3':
      status = SkyPromptStatus.Action3
      break
    default:
      status = SkyPromptStatus.Error
  }

  return { status, answer }
}

export default async function skyPrompt(opts: SkyPromptOptions = {}): Promise<SkyPromptResponse> {
  const { code, stdout } = await runCommand(GUI_PROMPT, promptArgs(opts))
  return parsePromptOutput(code, stdout)
}
