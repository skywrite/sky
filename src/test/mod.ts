/**
 * Test abstraction layer
 *
 * Wraps bun:test to support Deno.test-style call signatures:
 *   - test(name, fn)
 *   - test(name, { ignore }, fn)
 *   - test({ name, ignore, fn })
 *   - test({ name, ignore }, fn)
 *   - t.step(name, fn) → nested test via describe
 */

import { test as bunTest, describe } from 'bun:test'

/** Test context with step/skip support */
interface TestContext {
  step: (name: string, fn: () => void | Promise<void>) => Promise<void>
  skip: (reason?: string) => void
}

class SkipError extends Error {
  constructor(reason?: string) {
    super(reason ?? 'skipped')
    this.name = 'SkipError'
  }
}

function makeContext(): TestContext {
  return {
    async step(name: string, fn: () => void | Promise<void>) {
      await fn()
    },
    skip(reason?: string) {
      throw new SkipError(reason)
    },
  }
}

type TestFn = (t: TestContext) => void | Promise<void>

interface TestOptions {
  ignore?: boolean
  skip?: boolean | string
}

interface TestDefinition extends TestOptions {
  name: string
  fn?: TestFn
}

function shouldSkip(opts: TestOptions | undefined): boolean {
  if (!opts) return false
  return !!(opts.ignore ?? opts.skip)
}

function wrapSkippable(fn: TestFn): () => Promise<void> {
  return async () => {
    try {
      await fn(makeContext())
    } catch (e) {
      if (e instanceof SkipError) return // silently pass — runtime skip
      throw e
    }
  }
}

// Overloads matching Deno.test signatures
function test(name: string, fn: TestFn): void
function test(name: string, options: TestOptions, fn: TestFn): void
function test(definition: TestDefinition, fn?: TestFn): void
function test(fn: TestFn): void
function test(first: string | TestDefinition | TestFn, second?: TestOptions | TestFn, third?: TestFn): void {
  // test(fn)
  if (typeof first === 'function') {
    bunTest('(anonymous)', wrapSkippable(first))
    return
  }

  // test({ name, ignore?, fn? }, fn?)
  if (typeof first === 'object') {
    const fn = (typeof second === 'function' ? second : first.fn)!
    if (shouldSkip(first)) {
      bunTest.skip(first.name, wrapSkippable(fn))
    } else {
      bunTest(first.name, wrapSkippable(fn))
    }
    return
  }

  // test(name, fn) or test(name, options, fn)
  if (typeof second === 'function') {
    bunTest(first, wrapSkippable(second))
    return
  }
  const fn = third!
  if (shouldSkip(second as TestOptions)) {
    bunTest.skip(first, wrapSkippable(fn))
  } else {
    bunTest(first, wrapSkippable(fn))
  }
}

export { test }
export default test

// Re-export riteway testing utilities
export { assert, loadFixturesSync } from './riteway.ts'
export type { Assertion } from './riteway.ts'
