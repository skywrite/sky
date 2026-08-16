import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from '#test'
import MarkdownStore from './mod.ts'

// Create a temp directory with fixture files for relative path resolution tests
const TMP = join(tmpdir(), `sky-resolve-relative-test-${Date.now()}`)
const MESSAGES_DIR = join(TMP, 'time', '2026', '02', '09-15', '10', 'actions', 'messages')

function setup() {
  mkdirSync(MESSAGES_DIR, { recursive: true })
  writeFileSync(join(MESSAGES_DIR, 'email_Nick-to-Sam.md'), '---\ntitle: Email\n---\n')
  writeFileSync(join(MESSAGES_DIR, 'slack_Tim-to-Sam.md'), '---\ntitle: Slack\n---\n')
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true })
}

test('resolve - ./ref resolves to sibling .md file', async () => {
  setup()
  try {
    const store = await MarkdownStore.build({ peopleDirs: [], orgDirs: [] })
    const sourceFile = join(MESSAGES_DIR, 'slack_Tim-to-Sam.md')

    const ref = store.resolve('./email_Nick-to-Sam', { sourceFilePath: sourceFile })

    assert({
      given: './email_Nick-to-Sam from sibling file',
      should: 'resolve as file type',
      actual: ref.type,
      expected: 'file',
    })

    assert({
      given: './email_Nick-to-Sam from sibling file',
      should: 'resolve to absolute path with .md',
      actual: 'path' in ref && ref.path,
      expected: join(MESSAGES_DIR, 'email_Nick-to-Sam.md'),
    })
  } finally {
    teardown()
  }
})

test('resolve - ./ref with .md extension resolves exact path', async () => {
  setup()
  try {
    const store = await MarkdownStore.build({ peopleDirs: [], orgDirs: [] })
    const sourceFile = join(MESSAGES_DIR, 'slack_Tim-to-Sam.md')

    const ref = store.resolve('./email_Nick-to-Sam.md', { sourceFilePath: sourceFile })

    assert({
      given: './ref with explicit .md extension',
      should: 'resolve as file type',
      actual: ref.type,
      expected: 'file',
    })

    assert({
      given: './ref with explicit .md extension',
      should: 'resolve to exact path',
      actual: 'path' in ref && ref.path,
      expected: join(MESSAGES_DIR, 'email_Nick-to-Sam.md'),
    })
  } finally {
    teardown()
  }
})

test('resolve - ./ref returns unresolved when file does not exist', async () => {
  setup()
  try {
    const store = await MarkdownStore.build({ peopleDirs: [], orgDirs: [] })
    const sourceFile = join(MESSAGES_DIR, 'slack_Tim-to-Sam.md')

    const ref = store.resolve('./nonexistent-file', { sourceFilePath: sourceFile })

    assert({
      given: './ref pointing to missing file',
      should: 'resolve as unresolved',
      actual: ref.type,
      expected: 'unresolved',
    })
  } finally {
    teardown()
  }
})

test('resolve - ./ref without sourceFilePath falls through to unresolved', async () => {
  setup()
  try {
    const store = await MarkdownStore.build({ peopleDirs: [], orgDirs: [] })

    const ref = store.resolve('./email_Nick-to-Sam')

    assert({
      given: './ref without sourceFilePath context',
      should: 'resolve as unresolved',
      actual: ref.type,
      expected: 'unresolved',
    })
  } finally {
    teardown()
  }
})

test('resolve - ./ref preserves raw string', async () => {
  setup()
  try {
    const store = await MarkdownStore.build({ peopleDirs: [], orgDirs: [] })
    const sourceFile = join(MESSAGES_DIR, 'slack_Tim-to-Sam.md')

    const ref = store.resolve('./email_Nick-to-Sam', { sourceFilePath: sourceFile })

    assert({
      given: './ref that resolves',
      should: 'preserve original raw string',
      actual: ref.raw,
      expected: './email_Nick-to-Sam',
    })
  } finally {
    teardown()
  }
})
