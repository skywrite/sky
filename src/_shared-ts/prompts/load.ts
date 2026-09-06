import * as path from 'node:path'
import { DIR_AI, DIR_CODE_SRC } from '#shared/config.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { PromptCatalog } from './catalog.ts'

export function createPromptCatalog(): PromptCatalog {
  return new PromptCatalog({ sourceDir: DIR_CODE_SRC, overrideDir: path.join(DIR_AI, 'prompts') })
}

/** Read a prompt afresh, applying notebook customizations and saved template references. */
export async function readPromptFile(file: string): Promise<string> {
  const id = path.relative(DIR_CODE_SRC, file).split(path.sep).join('/')
  if (id.startsWith('../') || path.isAbsolute(id) || !id.endsWith('.prompt.md')) return readTextFile(file)
  return createPromptCatalog().expand(id)
}
