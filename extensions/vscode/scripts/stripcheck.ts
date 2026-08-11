// Guard: every file reachable from the extension's entry points must be
// loadable by Node's type stripper — the extension ships as raw TypeScript.
//
// This catches what the typechecker cannot: syntax tsc accepts but the
// runtime rejects. erasableSyntaxOnly (tsconfig) covers parameter
// properties, enums, and runtime namespaces at typecheck time, but
// angle-bracket assertions (`<T>x`) are erasable syntax that Node still
// refuses (JSX ambiguity) — running the real stripper over the real import
// graph is the only complete check.
//
// Run: node scripts/stripcheck.ts   (Node per .nvmrc; also `npm run check`)
import { readFileSync, existsSync, statSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(EXT, '..', '..')
const SRC = path.join(ROOT, 'src')
const SHARED = path.join(SRC, '_shared-ts')

// The runtime graph (extension.ts) plus the test-host graph — both are
// loaded by stripping, so both must stay clean. Test files are discovered by
// glob because the suite imports them via computed URLs the specifier walker
// below cannot follow.
import { readdirSync } from 'node:fs'
const testFiles = readdirSync(path.join(EXT, 'src'), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('_test.ts'))
  .map((e) => path.join(e.parentPath, e.name))
// scripts/ also runs under Node's stripper (npm run check, syncTitles).
const scriptFiles = readdirSync(path.join(EXT, 'scripts'), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.ts'))
  .map((e) => path.join(e.parentPath, e.name))
const ENTRIES = [
  path.join(EXT, 'src', 'extension.ts'),
  path.join(EXT, 'src', 'test', 'runTest.ts'),
  path.join(EXT, 'src', 'test', 'suite', 'index.ts'),
  ...testFiles,
  ...scriptFiles,
]

function resolveSpec(spec: string, fromFile: string): string | null {
  if (spec.startsWith('node:') || spec === 'vscode') return null
  let base: string
  if (spec === '#config') base = path.join(SHARED, 'config.ts')
  else if (spec.startsWith('#shared/')) base = path.join(SHARED, spec.slice('#shared/'.length))
  else if (spec.startsWith('#universal/')) base = path.join(SHARED, 'universal', spec.slice('#universal/'.length))
  else if (spec.startsWith('#lib/')) base = path.join(SRC, 'lib', spec.slice('#lib/'.length))
  else if (spec.startsWith('#commands/')) base = path.join(SRC, 'commands', spec.slice('#commands/'.length))
  else if (spec.startsWith('#service/')) base = path.join(SRC, 'service', spec.slice('#service/'.length))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return null // bare npm specifier — resolved from node_modules, not stripped
  const isFile = (p: string) => {
    try {
      return existsSync(p) && statSync(p).isFile()
    } catch {
      return false
    }
  }
  for (const c of [base, base + '.ts', path.join(base, 'mod.ts'), path.join(base, 'index.ts'), base + '.d.ts']) {
    if (isFile(c)) return c
  }
  return null
}

const IMPORT_RES = [
  /(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const seen = new Set<string>()
const unresolved: string[] = []

function walk(file: string): void {
  if (seen.has(file)) return
  seen.add(file)
  let src: string
  try {
    src = readFileSync(file, 'utf8')
  } catch {
    return
  }
  // Collapse braced specifier lists onto a single line before matching: oxfmt
  // wraps a long `import { a, b, c } from '...'` across lines, and IMPORT_RES
  // deliberately stops at a newline, so a wrapped import would contribute no
  // specifier at all — silently shrinking the graph this guard walks. Only
  // innermost brace groups collapse, which is exactly what a specifier list is.
  const flat = src.replace(/\{[^{}]*\}/g, (m) => m.replace(/\s+/g, ' '))
  for (const re of IMPORT_RES) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(flat)) !== null) {
      const spec = m[1]
      if (!spec.startsWith('.') && !spec.startsWith('#')) continue
      const r = resolveSpec(spec, file)
      if (r) walk(r)
      else unresolved.push(`${path.relative(ROOT, file)}  ->  ${spec}`)
    }
  }
}

for (const e of ENTRIES) walk(e)

const failures: Array<{ file: string; msg: string }> = []
for (const f of [...seen].sort()) {
  if (f.endsWith('.d.ts')) continue // type-only, never loaded at runtime
  const src = readFileSync(f, 'utf8')
  try {
    stripTypeScriptTypes(src, { mode: 'strip', sourceMap: false })
  } catch (err) {
    failures.push({
      file: path.relative(ROOT, f),
      msg: String((err as Error).message)
        .split('\n')[0]
        .slice(0, 140),
    })
  }
}

console.log(`stripcheck: ${seen.size} files reachable from ${ENTRIES.length} entries`)
if (unresolved.length) {
  console.log(`\nWARN — unresolved specifiers (not walked):`)
  for (const u of unresolved) console.log('  ' + u)
}
if (failures.length) {
  console.log(`\nFAIL — ${failures.length} file(s) Node cannot strip:`)
  for (const f of failures) console.log(`  ${f.file}\n    ${f.msg}`)
  process.exit(1)
}
console.log('OK — every reachable file survives the stripper')
