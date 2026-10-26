import { readdirSync } from 'node:fs'
import * as path from 'node:path'

/**
 * Every folder at the top of the notebook: the named ones first, in the
 * order given (the scanner's walk order depends on it), then every other
 * visible folder by name. Sky reads its whole notebook, so a folder it has
 * no model for (field-guides/, one made tomorrow) is still read, browsed and
 * watched. Hidden folders (.git, .vscode) stay out. A notebook that isn't
 * there yet leaves just the named folders.
 */
export function notebookDirs(base: string, named: string[]): string[] {
  let found: string[]
  try {
    found = readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(base, entry.name))
  } catch {
    return named
  }
  const known = new Set(named)
  return [...named, ...found.filter((dir) => !known.has(dir)).sort()]
}
