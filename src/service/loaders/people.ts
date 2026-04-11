import { access, lstat } from 'node:fs/promises'
import * as path from 'node:path'
import * as config from '#shared/config.ts'
import { readTextFile, walk } from '#shared/fs/mod.ts'
// Imported directly from watch.ts, not fs/mod.ts — see fs/mod.ts for why
import { watchFs } from '#shared/fs/watch.ts'
import MarkdownDoc from '#shared/models/Markdown/Document/mod.ts'
import store from '../store.ts'

async function filterExistingDirs(dirs: string[]): Promise<string[]> {
  const existing: string[] = []
  for (const dir of dirs) {
    try {
      await access(dir)
      existing.push(dir)
    } catch {
      // directory doesn't exist, skip it
    }
  }
  return existing
}

async function populateTagsAndWatch() {
  const dirs = await filterExistingDirs(config.DIRS_MARKDOWN)
  await walkDirsAndUpdateTags(dirs)

  const watcherEvents = ['modify', 'create']

  const watcher = watchFs(dirs)
  for await (const event of watcher) {
    // { kind: "create", paths: [ "/foo.txt" ] }
    if (!watcherEvents.includes(event.kind)) return

    console.log(event)

    for (const p of event.paths) {
      try {
        const statInfo = await lstat(p)
        if (statInfo.isDirectory()) await walkDirsAndUpdateTags([p])
        if (statInfo.isFile()) await readFileAndUpdateTags(p)
      } catch (err) {
        console.error(err)
      }
    }
  }
}

async function walkDirsAndUpdateTags(dirs: string[]) {
  for (const dir of dirs) {
    for await (const entry of walk(dir)) {
      try {
        await readFileAndUpdateTags(entry.path)
      } catch (err) {
        console.error(`FILE: ${entry.path}`)
        console.error(err)
      }
    }
  }
}

async function readFileAndUpdateTags(file: string) {
  if (path.extname(file) !== '.md') return

  const contents = await readTextFile(file)
  const md = MarkdownDoc.fromMarkdown(contents)
  if (md.tags.size === 0) return

  const newSet = store.tags.union(md.tags)
  store.update('tags', newSet)
}
