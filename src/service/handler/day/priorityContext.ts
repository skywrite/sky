import { readdir, realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { readOptional } from '#lib/outbox/files.ts'
import { dayDir, weekDir } from '#shared/nbfs/mod.ts'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'

/** Bounded, deterministic context from this notebook only; sparse notebooks need no setup. */
export async function readPriorityContext(root: string, timeDir: string, day: PlainDate, links: string[]) {
  const files: string[] = [
    path.join(root, 'me', 'about.md'),
    path.join(timeDir, weekDir(Week.of(day).startInYear), 'week.md'),
    path.join(timeDir, 'commitments.md'),
  ]
  const list = async (dir: string, limit: number) => {
    const names = await readdir(dir).catch(() => [])
    files.push(
      ...names
        .filter((name) => name.endsWith('.md'))
        .sort()
        .slice(-limit)
        .map((name) => path.join(dir, name)),
    )
  }
  await list(path.join(root, 'goals'), 12)
  const current = path.join(timeDir, dayDir(day))
  await list(path.join(current, 'most-important'), 8)
  for (let offset = 0; offset < 3; offset++) {
    const dir = path.join(timeDir, dayDir(day.addDays(-offset)))
    await list(path.join(dir, 'journal'), 4)
    if (offset) files.push(path.join(dir, 'summary.md'))
  }
  for (const link of links) {
    if (/^[a-z][\w+.-]*:|^\/\//i.test(link)) continue
    const pathname = link.split('#')[0].split('?')[0]
    files.push(path.resolve(current, pathname))
  }
  const base = await realpath(root)
  const documents: Array<{ path: string; text: string; excerpt: boolean }> = []
  let remaining = 28_000
  for (const file of new Set(files)) {
    if (remaining <= 0) break
    const resolved = await realpath(file).catch(() => null)
    if (!resolved || !resolved.startsWith(base + path.sep) || !resolved.endsWith('.md')) continue
    if ((await stat(resolved)).size > 256_000) continue
    const content = await readOptional(resolved)
    if (!content?.trim()) continue
    const limit = Math.min(5000, remaining)
    const text = content.slice(0, limit)
    documents.push({ path: path.relative(base, resolved), text, excerpt: content.length > limit })
    remaining -= text.length
  }
  return documents
}
