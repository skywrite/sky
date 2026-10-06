import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, test } from '#test'
import { PromptCatalog } from './catalog.ts'

// Every prompt in the source tree must parse and expand: a reference the
// catalog's regex accepts but Handlebars rejects (an unquoted root-relative
// `{{> /path/name}}`) only surfaced at the first live run (2026-10-05).
// The source tree is located from this file, not from the user's config: CI has no notebook config.
const SOURCE_DIR = fileURLToPath(new URL('../../', import.meta.url))

test('every source prompt parses and expands its template references', async () => {
  const overrideDir = await mkdtemp(path.join(tmpdir(), 'sky-source-prompts-'))
  try {
    const catalog = new PromptCatalog({ sourceDir: SOURCE_DIR, overrideDir })
    const entries = await catalog.list()
    const failures: string[] = []
    for (const entry of entries) {
      if (entry.error) {
        failures.push(`${entry.id}: ${entry.error}`)
        continue
      }
      try {
        const expanded = await catalog.expand(entry.id)
        if (/{{[~\s]*>/.test(expanded)) failures.push(`${entry.id}: a template reference survived expansion`)
      } catch (err) {
        failures.push(`${entry.id}: ${(err as Error).message}`)
      }
    }
    assert({
      given: `the ${entries.length} prompt files under src`,
      should: 'all parse, and expand every template reference',
      actual: { atLeastOne: entries.length > 0, failures },
      expected: { atLeastOne: true, failures: [] },
    })
  } finally {
    await rm(overrideDir, { recursive: true, force: true })
  }
})
