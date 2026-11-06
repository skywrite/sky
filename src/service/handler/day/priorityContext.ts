import { readdir, realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { readOptional } from '#lib/outbox/files.ts'
import { dayDir, weekDir } from '#shared/nbfs/mod.ts'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'

function contextPaths(root: string, timeDir: string, day: PlainDate, links: string[]) {
  const current = path.join(timeDir, dayDir(day))
  const sources: Array<{ file: string } | { dir: string; limit: number }> = [
    { file: path.join(root, 'me', 'about.md') },
    { file: path.join(timeDir, weekDir(Week.of(day).startInYear), 'week.md') },
    { file: path.join(timeDir, 'commitments.md') },
    { dir: path.join(root, 'goals'), limit: 12 },
    { dir: path.join(current, 'most-important'), limit: 8 },
  ]
  for (let offset = 0; offset < 3; offset++) {
    const dir = path.join(timeDir, dayDir(day.addDays(-offset)))
    sources.push({ dir: path.join(dir, 'journal'), limit: 4 })
    if (offset) sources.push({ file: path.join(dir, 'summary.md') })
  }
  for (const link of links) {
    if (/^[a-z][\w+.-]*:|^\/\//i.test(link)) continue
    const pathname = link.split('#')[0].split('?')[0]
    sources.push({ file: path.resolve(current, pathname) })
  }
  return sources
}

/** Include missing files and direct-child Markdown folders, so creation and deletion invalidate the context too. */
export function priorityContextSources(root: string, timeDir: string, day: PlainDate, links: string[]) {
  const relative = (file: string) => {
    const name = path.relative(root, file)
    return !name || name === '..' || name.startsWith(`..${path.sep}`) || path.isAbsolute(name)
      ? null
      : name.split(path.sep).join('/')
  }
  return contextPaths(root, timeDir, day, links).flatMap((source) => {
    const name = relative('file' in source ? source.file : source.dir)
    if (!name) return []
    return 'file' in source ? (name.endsWith('.md') ? [name] : []) : [name + '/']
  })
}

/** Bounded, deterministic context from this notebook only; sparse notebooks need no setup. */
export async function readPriorityContext(root: string, timeDir: string, day: PlainDate, links: string[]) {
  const files: string[] = []
  for (const source of contextPaths(root, timeDir, day, links)) {
    if ('file' in source) {
      files.push(source.file)
      continue
    }
    const { dir, limit } = source
    const names = await readdir(dir).catch(() => [])
    files.push(
      ...names
        .filter((name) => name.endsWith('.md'))
        .sort()
        .slice(-limit)
        .map((name) => path.join(dir, name)),
    )
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
