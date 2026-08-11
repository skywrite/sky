import { readdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Mocha from 'mocha'

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000,
    reporter: 'spec',
  })
  const root = mocha.suite

  // Test files call suite()/test() as globals. Mocha's tdd ui installs those
  // only under its own loader; here the files are imported directly, so wire
  // up a minimal shim. Object.assign because these lambdas deliberately
  // implement only the callable part of Mocha's SuiteFunction/TestFunction
  // interfaces (no .only/.skip).
  Object.assign(globalThis, {
    suite: (title: string, fn: () => void) => {
      const s = Mocha.Suite.create(root, title)
      fn.call(s)
      return s
    },
    test: (title: string, fn: Mocha.Func | Mocha.AsyncFunc) => {
      const t = new Mocha.Test(title, fn)
      root.addTest(t)
      return t
    },
  })

  // Discover every *_test.ts under src/ — import after the globals exist so
  // top-level suite()/test() calls in the files resolve.
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const testFiles = readdirSync(srcDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('_test.ts'))
    .map((e) => path.join(e.parentPath, e.name))
    .sort()

  console.log(`Discovered ${testFiles.length} test file(s)`)
  for (const f of testFiles) await import(pathToFileURL(f).href)

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} tests failed.`))
      else resolve()
    })
  })
}
