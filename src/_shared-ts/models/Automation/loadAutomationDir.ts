import * as path from 'node:path'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import type { StoreError } from '../Store/types.ts'
import Automation from './mod.ts'

export type AutomationFileEntry = { automation: Automation; path: string }

export type LoadAutomationDirResult = {
  byName: Map<string, AutomationFileEntry>
  errors: StoreError[]
}

/** A notebook directory invites a README; it is documentation, not a charter */
const NOT_CHARTERS = new Set(['readme'])

/**
 * Read every charter in a directory.
 *
 * One unreadable charter never stops the others: its complaint lands in
 * `errors` keyed by path, for `automations:status` to show. A missing directory
 * is not an error — it just means nothing is declared yet.
 */
export async function loadAutomationDir(dir: string): Promise<LoadAutomationDirResult> {
  const byName = new Map<string, AutomationFileEntry>()
  const errors: StoreError[] = []

  if (!(await exists(dir))) return { byName, errors }

  for await (const entry of walk(dir, { exts: ['.md'], includeDirs: false })) {
    const name = path.basename(entry.path, path.extname(entry.path))
    if (NOT_CHARTERS.has(name.toLowerCase())) continue

    try {
      const contents = await readTextFile(entry.path)
      byName.set(name, { automation: Automation.fromMarkdown(contents, name), path: entry.path })
    } catch (err) {
      errors.push({
        path: entry.path,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { byName, errors }
}

export default loadAutomationDir
