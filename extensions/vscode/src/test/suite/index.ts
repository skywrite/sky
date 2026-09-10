import { readdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * The extension's test runner.
 *
 * @vscode/test-electron launches VS Code with the extension loaded and calls
 * run() from inside the extension host — the tests need that host, since
 * they open documents and fire commands through the vscode API. Inside it,
 * something in-process has to collect the tests, run them, and report back.
 * That is all this file does, so it depends on nothing: the tests use no
 * hooks, focus, or reporters, and Node's own runner cannot finish in here
 * (in-process it finalizes only when the process is about to exit, which
 * an extension host never is).
 *
 * Test files call test() as a global. run() installs it, imports every
 * *_test.ts under src/ so their top-level calls register, then runs what was
 * registered one test at a time and rejects if any failed.
 */

const TIMEOUT_MS = 10_000

type TestFn = () => void | Promise<void>

interface Registered {
  readonly file: string
  readonly title: string
  readonly fn: TestFn
}

type Outcome = { readonly passed: true } | { readonly passed: false; readonly error: unknown }

declare global {
  /** Registers a test. Available in *_test.ts files; the runner supplies it. */
  function test(title: string, fn: TestFn): void
}

export async function run(): Promise<void> {
  const registered: Registered[] = []
  let loading = ''
  Object.assign(globalThis, {
    test: (title: string, fn: TestFn) => {
      registered.push({ file: loading, title, fn })
    },
  })

  // Discover every *_test.ts under src/ — import after the global exists so
  // top-level test() calls in the files resolve.
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const files = readdirSync(srcDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('_test.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()

  console.log(`Discovered ${files.length} test file(s)`)
  for (const file of files) {
    loading = path.relative(srcDir, file)
    await import(pathToFileURL(file).href)
  }

  let failed = 0
  let heading = ''
  for (const { file, title, fn } of registered) {
    if (file !== heading) {
      heading = file
      console.log(`\n${heading}`)
    }
    const started = performance.now()
    const outcome = await runOne(fn)
    const elapsed = `(${Math.round(performance.now() - started)}ms)`
    if (outcome.passed) {
      console.log(`  ✔ ${title} ${elapsed}`)
    } else {
      failed++
      console.log(`  ✖ ${title} ${elapsed}`)
      console.log(indent(describe(outcome.error)))
    }
  }

  console.log(`\n${registered.length - failed} passing, ${failed} failing`)
  if (failed > 0) throw new Error(`${failed} tests failed.`)
}

/** Runs one test to its outcome. A synchronous throw, a rejection, and a timeout all fail it. */
async function runOne(fn: TestFn): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
  })
  try {
    await Promise.race([Promise.resolve().then(fn), timeout])
    return { passed: true }
  } catch (error) {
    return { passed: false, error }
  } finally {
    clearTimeout(timer)
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n')
}
