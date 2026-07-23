// Guard for the two ways the extension's dual-view resolution could rot:
//
// 1. Dependency versions. Imports in EXTENSION source resolve from this
//    package's node_modules; imports in SHARED code resolve from
//    src/node_modules (at runtime via the symlinks' realpath, at typecheck
//    via the tsconfig "paths" block). Any package declared here that also
//    exists in src must be version-identical, or the same specifier loads
//    different code depending on which side imports it.
//
// 2. Resolution maps. package.json "imports" (what Node uses — targets go
//    through the shared/lib symlinks) and tsconfig "paths" (what tsc uses —
//    targets are the real locations) must cover the same namespaces with
//    equivalent targets, or the editor typechecks a different graph than
//    the one Node runs.
//
// Run: node scripts/depparity.ts   (also part of `npm run check`)
import { readFileSync, realpathSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.resolve(EXT, '..', '..', 'src')

let bad = 0

// --- 1. Dependency version parity -----------------------------------------

function installedVersion(baseDir: string, name: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(baseDir, 'node_modules', name, 'package.json'), 'utf8'))
    return pkg.version as string
  } catch {
    return null
  }
}

const manifest = JSON.parse(readFileSync(path.join(EXT, 'package.json'), 'utf8'))
const deps = Object.keys(manifest.dependencies ?? {})

for (const name of deps) {
  const here = installedVersion(EXT, name)
  const inSrc = installedVersion(SRC, name)
  if (here === null) {
    console.log(`FAIL  ${name}: not installed here — run npm install`)
    bad++
  } else if (inSrc === null) {
    console.log(`note  ${name}: ${here} (not in src — extension-only dep, no parity needed)`)
  } else if (here !== inSrc) {
    console.log(`FAIL  ${name}: extension has ${here}, src has ${inSrc} — the two sides load different code`)
    bad++
  } else {
    console.log(`ok    ${name}: ${here}`)
  }
}

// --- 2. Resolution-map parity: "imports" (runtime) vs "paths" (typecheck) ---

function stripLineComments(jsonc: string): string {
  return jsonc
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const tsconfig = JSON.parse(stripLineComments(readFileSync(path.join(EXT, 'tsconfig.json'), 'utf8')))
const importsMap: Record<string, string> = manifest.imports ?? {}
const pathsMap: Record<string, string[]> = tsconfig.compilerOptions?.paths ?? {}

const importKeys = Object.keys(importsMap).sort()
const pathKeys = Object.keys(pathsMap).sort()

if (importKeys.join('|') !== pathKeys.join('|')) {
  console.log(`FAIL  imports/paths namespaces differ:\n        imports: ${importKeys.join(', ') || '(none)'}\n        paths:   ${pathKeys.join(', ') || '(none)'}`)
  bad++
} else {
  for (const key of importKeys) {
    const runtimeTarget = path.join(EXT, importsMap[key].replace(/\*$/, ''))
    const typecheckTarget = path.resolve(EXT, pathsMap[key][0].replace(/\*$/, ''))
    let runtimeReal: string
    try {
      runtimeReal = realpathSync(runtimeTarget)
    } catch {
      console.log(`FAIL  ${key}: runtime target ${importsMap[key]} does not resolve — broken symlink?`)
      bad++
      continue
    }
    if (runtimeReal === typecheckTarget) {
      console.log(`ok    ${key}: imports and paths agree (${path.relative(EXT, typecheckTarget)})`)
    } else {
      console.log(`FAIL  ${key}: runtime resolves to ${runtimeReal}, typecheck to ${typecheckTarget}`)
      bad++
    }
  }
}

// ---------------------------------------------------------------------------

if (bad > 0) {
  console.log(`\ndepparity: ${bad} mismatch(es). Align versions with src / re-sync imports and paths, then re-run.`)
  process.exit(1)
}
console.log('depparity: dep versions match src; imports and paths maps agree')
