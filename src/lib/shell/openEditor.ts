import { setTimeout as delay } from 'node:timers/promises'
import oe from 'open-editor'

// would like to see this included
// https://github.com/sindresorhus/open-editor/pull/17

export type PathLike = {
  file: string
  line?: number
  column?: number
}

export default async function openEditor(files: PathLike[], options?: { editor?: string }) {
  await oe(files, options?.editor ? { editor: options.editor } : undefined)
  await delay(500)
}
