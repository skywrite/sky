import { runCommand } from '#lib/sys/mod.ts'

export enum SkyPromptStatus {
  Error,
  Cancel,
  Ok,
  Action1,
  Action2,
}

export type SkyPromptResponse = {
  status: SkyPromptStatus
  answer: string
}

export interface SkyPromptOptions {
  question?: string
  defaultAnswer?: string
  selectRange?: { start: number; length: number }
  action1?: string
  action2?: string
}

export default async function skyPrompt(opts: SkyPromptOptions = {}): Promise<SkyPromptResponse> {
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

  const { code, stdout: output } = await runCommand('sky-prompt', args)
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
    default:
      status = SkyPromptStatus.Error
  }

  return { status, answer }
}
