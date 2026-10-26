/**
 * A front matter change written straight to the file — how the reading view makes one, with no
 * editor holding the document. The change applies to what the file holds now and is written under
 * its version; when another write lands in between, the file is read again, once.
 */

import { joinFrontmatter, splitFrontmatter } from './model.ts'

const UNREACHABLE = 'Sky could not be reached. Try again.'

/** Writes the change and answers the front matter body the file now holds. */
export async function saveFrontmatter(file: string, change: (body: string) => string): Promise<string> {
  const url = `/docs/_api/content/${file.split('/').map(encodeURIComponent).join('/')}`
  for (let attempt = 0; ; attempt++) {
    const read = await fetch(url).catch(() => null)
    if (!read) throw new Error(UNREACHABLE)
    const doc = (await read.json().catch(() => ({}))) as { content?: unknown; version?: unknown; message?: string }
    if (!read.ok || typeof doc.content !== 'string') throw new Error(doc.message ?? 'The file could not be read.')
    const { frontmatter, body } = splitFrontmatter(doc.content)
    const before = (frontmatter ?? '').replace(/\n$/, '')
    const next = change(before).replace(/\n$/, '')
    if (next === before) return next
    const written = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: joinFrontmatter(next, body), version: doc.version }),
    }).catch(() => null)
    if (!written) throw new Error(UNREACHABLE)
    if (written.ok) return next
    if (written.status === 409 && attempt === 0) continue
    const answer = (await written.json().catch(() => ({}))) as { message?: string }
    throw new Error(
      written.status === 409
        ? 'The file changed while it was being saved. Try again.'
        : (answer.message ?? 'The file could not be saved.'),
    )
  }
}
