#!/usr/bin/env -S deno run --allow-read

/**
 * Custom linter to check that the public @skywrite/* packages still resolve
 *
 * packages/*​/src holds thin façades that re-export out of src/, and nothing
 * inside src/ imports them — it reaches the same code through the #shared/...
 * aliases. So a rename or delete in src/ breaks the published API without any
 * other check noticing: @skywrite/core/ai/claude threw on import for three
 * weeks and six green CI runs before anyone tried to import it.
 *
 * Every entry point each package advertises is loaded here. Importing rather
 * than stat-ing is the point — the façade file itself usually still exists,
 * it's the module it re-exports from that went away.
 */

import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import colors from 'picocolors'
import { exists, readDir, readTextFile } from '#shared/fs/mod.ts'
import { exit } from '#shared/sys/mod.ts'

interface Violation {
  pkg: string
  entries: string[]
  target: string
  reason: string
}

const PACKAGES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages')

/**
 * Collect every file an exports map points at, keyed by target.
 *
 * Values are usually plain strings, but the field also allows conditions
 * ({ import, types, default }) and null to block a subpath, so walk it rather
 * than assuming. One target can be reached by several entries — `main`,
 * `types`, and exports['.'] typically name the same file — and it should be
 * reported once, not three times.
 */
function collectTargets(node: unknown, entry: string, into: Map<string, string[]>): void {
  if (typeof node === 'string') {
    if (!into.has(node)) into.set(node, [])
    into.get(node)!.push(entry)
    return
  }

  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectTargets(value, entry === '' ? key : `${entry} → ${key}`, into)
    }
  }
}

async function checkPackage(pkgDir: string): Promise<Violation[]> {
  const violations: Violation[] = []
  const manifest = JSON.parse(await readTextFile(path.join(pkgDir, 'package.json')))
  const pkgName = manifest.name ?? path.basename(pkgDir)

  const targets = new Map<string, string[]>()
  collectTargets(manifest.exports, '', targets)
  for (const field of ['main', 'types'] as const) {
    if (typeof manifest[field] === 'string') collectTargets(manifest[field], field, targets)
  }

  if (targets.size === 0) {
    return [{ pkg: pkgName, entries: ['exports'], target: '(none)', reason: 'package advertises no entry points' }]
  }

  for (const [target, entries] of targets) {
    const absolute = path.resolve(pkgDir, target)

    if (!(await exists(absolute))) {
      violations.push({ pkg: pkgName, entries, target, reason: 'target file does not exist' })
      continue
    }

    try {
      await import(pathToFileURL(absolute).href)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      violations.push({ pkg: pkgName, entries, target, reason: message.split('\n')[0] })
    }
  }

  return violations
}

async function main() {
  console.log(colors.blue('Checking that the public packages resolve...\n'))

  const allViolations: Violation[] = []
  let checked = 0

  for await (const entry of readDir(PACKAGES_DIR)) {
    if (!entry.isDirectory) continue

    const pkgDir = path.join(PACKAGES_DIR, entry.name)
    if (!(await exists(path.join(pkgDir, 'package.json')))) continue

    checked++
    allViolations.push(...(await checkPackage(pkgDir)))
  }

  if (checked === 0) {
    console.log(colors.red(`No packages found in ${PACKAGES_DIR}`))
    exit(1)
  }

  if (allViolations.length === 0) {
    console.log(colors.green(`✅ Every entry point in ${checked} package(s) resolves!`))
    exit(0)
  }

  console.log(colors.red(`Found ${allViolations.length} unresolvable entry point(s):\n`))

  const byPkg = new Map<string, Violation[]>()
  for (const violation of allViolations) {
    if (!byPkg.has(violation.pkg)) {
      byPkg.set(violation.pkg, [])
    }
    byPkg.get(violation.pkg)!.push(violation)
  }

  for (const [pkg, violations] of byPkg) {
    console.log(colors.yellow(`${pkg}:`))
    for (const v of violations) {
      console.log(`  ${colors.red(v.entries.join(', '))} → ${colors.gray(v.target)}`)
      console.log(`    ${colors.gray(v.reason)}`)
    }
    console.log()
  }

  console.log(colors.cyan('Hint: the façades in packages/*/src re-export out of src/.'))
  console.log(colors.gray('  If the code moved, repoint the façade at its new home.'))
  console.log(colors.gray('  If it was deleted on purpose, drop the file and its exports entry.'))

  exit(1)
}

if (import.meta.main) {
  await main()
}
