import { runCommand } from '#lib/sys/mod.ts'

export enum GuiPromptResponseStatus {
  Error,
  Cancel,
  Ok,
}

export type GuiPromptResponse = {
  status: GuiPromptResponseStatus
  answer: string
}

export interface GuiPromptOptions {
  defaultAnswer?: string
}

export default async function prompt(
  question: string,
  opts: GuiPromptOptions = { defaultAnswer: '' },
): Promise<GuiPromptResponse> {
  const { code, stdout: output } = await runCommand('gui-prompt', [question, opts.defaultAnswer ?? ''])
  if (code !== 0) return { status: GuiPromptResponseStatus.Error, answer: '' }

  let [statusText, answer] = output.split(': ')

  if (!answer) answer = ''
  answer = answer.trim() // cut off newline

  let status: GuiPromptResponseStatus
  switch (statusText) {
    case 'OK':
      status = GuiPromptResponseStatus.Ok
      break
    case 'CANCEL':
      status = GuiPromptResponseStatus.Cancel
      break
    default:
      status = GuiPromptResponseStatus.Error
  }

  return { status, answer }
}
