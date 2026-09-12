import { readFile } from 'node:fs/promises'
import { atomicWrite } from '#lib/outbox/files.ts'
import MessageDocument from '#shared/models/Message/mod.ts'

/** Recognition can take minutes. Refuse to replace edits made while preparing the capture. */
export async function saveSlackCaptureUpdate(
  file: string,
  original: MessageDocument | undefined,
  updated: MessageDocument,
): Promise<void> {
  const content = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  const current = content === undefined ? undefined : MessageDocument.fromMarkdown(content)
  if (current?.toMarkdown() !== original?.toMarkdown())
    throw new Error('The Slack conversation changed while preparing its update. Retry to preserve the new edits.')
  await atomicWrite(file, updated.toMarkdown())
}
