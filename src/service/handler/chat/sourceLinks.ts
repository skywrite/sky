import * as path from 'node:path'
import { atomicWrite, readOptional } from '#lib/outbox/files.ts'

export const sourceChatHref = (id: string) => `/chat/source/${encodeURIComponent(id)}`

/** A routing index, not a second transcript. Only successful filing creates an entry. */
export function chatSourceLinks(dir: string) {
  const file = (id: string) => path.join(dir, `${encodeURIComponent(id)}.json`)
  return {
    async get(id: string): Promise<string | null> {
      const content = await readOptional(file(id))
      if (!content) return null
      const saved: unknown = JSON.parse(content)
      return typeof saved === 'string' ? saved : null
    },
    async set(id: string, saved: string): Promise<void> {
      await atomicWrite(file(id), JSON.stringify(saved) + '\n')
    },
  }
}

export type ChatSourceLinks = ReturnType<typeof chatSourceLinks>
