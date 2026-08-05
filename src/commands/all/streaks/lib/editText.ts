import { unlink } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import openEditor from 'open-editor'
import { outputFile, readTextFile } from '#shared/fs/mod.ts'

/**
 * Remove seed HTML comments including the line slot they occupied, so an
 * untouched comment doesn't leave a blank line mid-list after stripping.
 */
export function stripEmbeddedComments(text: string): string {
  return text
    .replace(/\n?[ \t]*<!--[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Freeform multi-line input via the user's editor: seed a scratch file, open
 * it blocking (wait: true), read the result back. Returns the edited text,
 * or '' if the user saved nothing beyond whitespace.
 */
export async function editText(seed: string, filenameHint = 'streak-details'): Promise<string> {
  const file = path.join(os.tmpdir(), `sky-${filenameHint}-${process.pid}.md`)
  await outputFile(file, seed)

  try {
    await openEditor([{ file }], { wait: true })
    const edited = await readTextFile(file)
    return edited.trim()
  } finally {
    await unlink(file).catch(() => {})
  }
}
