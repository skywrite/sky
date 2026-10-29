import { readFile } from 'node:fs/promises'
import { walk } from '#shared/fs/mod.ts'

/** The browser harness's watcher on every platform: only scan the tiny temporary notebook, never real data. */
export async function pollNotebookFixture(
  dirs: string[],
  changed: (file: string, contents: string | undefined) => void,
): Promise<() => Promise<void>> {
  const read = async () => {
    const files = new Map<string, string>()
    for (const dir of dirs) {
      for await (const entry of walk(dir, { includeDirs: false, exts: ['.md'] })) {
        const content = await readFile(entry.path, 'utf8').catch(() => undefined)
        if (content !== undefined) files.set(entry.path, content)
      }
    }
    return files
  }
  let previous = await read()
  let active = true
  let running = Promise.resolve()
  let failure: unknown
  let timer: ReturnType<typeof setTimeout>
  const schedule = () => {
    timer = setTimeout(() => {
      running = read()
        .then((next) => {
          if (!active) return
          for (const [file, contents] of next) if (previous.get(file) !== contents) changed(file, contents)
          for (const file of previous.keys()) if (!next.has(file)) changed(file, undefined)
          previous = next
        })
        .catch((error) => {
          failure = error
        })
        .finally(() => {
          if (active) schedule()
        })
    }, 50)
  }
  schedule()
  return async () => {
    active = false
    clearTimeout(timer)
    await running
    if (failure) throw failure
  }
}
