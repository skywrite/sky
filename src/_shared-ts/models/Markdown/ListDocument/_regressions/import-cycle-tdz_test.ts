import { spawnSync } from 'node:child_process'
import { assert, test } from '#test'

/**
 * Regression: a process whose first import is ListDocument threw
 * "Cannot access 'ListDocument' before initialization". ItemList imported
 * Document through the family barrel (Markdown/mod.ts), which re-exports
 * MarkdownStore; its stores reach Day, and `class DayDocument extends
 * ListDocument` ran while ListDocument was still initializing. A whole-tree
 * `bun test` never saw it because some earlier file loaded Day first — so this
 * guard runs the load order that fails in its own process.
 */

const LIST_DOCUMENT = new URL('../mod.ts', import.meta.url).pathname
const DAY_DOCUMENT = new URL('../../../Day/document/mod.ts', import.meta.url).pathname

test('ListDocument can be the first module loaded, then Day', () => {
  const script = `
    await import(${JSON.stringify(LIST_DOCUMENT)})
    const { default: DayDocument } = await import(${JSON.stringify(DAY_DOCUMENT)})
    if (typeof DayDocument !== 'function') throw new Error('DayDocument did not load')
  `
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })

  assert({
    given: 'a fresh process that imports ListDocument before Day',
    should: 'load both without a temporal-dead-zone error',
    actual: [result.status, result.stderr.includes('before initialization')],
    expected: [0, false],
  })
})
