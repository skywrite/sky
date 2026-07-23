// Guard: the typechecker and the runtime resolve some deps from different
// installs. Extension-source imports (@anthropic-ai/sdk, ws, yaml) load from
// this package's node_modules at runtime. But shared code reached through the
// `shared` symlink realpaths into src/_shared-ts, so ITS deps (handlebars,
// jsonc-parser, marked) load from src/node_modules at runtime — while tsc,
// which resolves from the symlink path, typechecks them against the copies
// installed here. If the two installs diverge, we typecheck against one
// version and run another. This asserts they are identical.
//
// Run: node scripts/depparity.ts   (also part of `npm run check`)
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.resolve(EXT, '..', '..', 'src')

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

let bad = 0
for (const name of deps) {
  const here = installedVersion(EXT, name)
  const inSrc = installedVersion(SRC, name)
  if (here === null) {
    console.log(`FAIL  ${name}: not installed here — run npm install`)
    bad++
  } else if (inSrc === null) {
    console.log(`note  ${name}: ${here} (not in src — extension-only dep, no parity needed)`)
  } else if (here !== inSrc) {
    console.log(`FAIL  ${name}: extension has ${here}, src has ${inSrc} — typecheck and runtime disagree`)
    bad++
  } else {
    console.log(`ok    ${name}: ${here}`)
  }
}

if (bad > 0) {
  console.log(`\ndepparity: ${bad} mismatch(es). Pin the extension's version to match src, then npm install.`)
  process.exit(1)
}
console.log('depparity: all shared dependency versions match src')
