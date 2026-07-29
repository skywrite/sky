import { assert, test } from '#test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer } from '#service/server.ts'
import MarkdownSelectorTask from './sel.ts'

// realpath so watcher/path comparisons see symlink-free paths (macOS /tmp and
// /var are symlinks into /private)
const TEST_DIR = path.join(realpathSync(os.tmpdir()), 'notebook-sel-test')

async function setupTestDir() {
  await rm(TEST_DIR, { recursive: true, force: true })

  const dirs = {
    people: path.join(TEST_DIR, 'people'),
    peopleOld: path.join(TEST_DIR, 'people-old'),
    orgs: path.join(TEST_DIR, 'orgs'),
    projects: path.join(TEST_DIR, 'projects'),
    places: path.join(TEST_DIR, 'places'),
    time: path.join(TEST_DIR, 'time'),
  }

  await mkdir(dirs.people, { recursive: true })
  await mkdir(dirs.peopleOld, { recursive: true })
  await mkdir(dirs.orgs, { recursive: true })
  await mkdir(dirs.projects, { recursive: true })
  await mkdir(dirs.places, { recursive: true })
  await mkdir(dirs.time, { recursive: true })

  // Create test person
  await writeFile(
    path.join(dirs.people, 'alice.md'),
    `---
name: Alice Smith
org: Acme Corp
title: Engineer
tags:
  - tech
---

# Alice Smith
`,
  )

  // Create test org
  await writeFile(
    path.join(dirs.orgs, 'acme.md'),
    `---
name: Acme Corp
sector: Technology
site: https://acme.example.com
tags:
  - Organization/Company
---

# Acme Corp
`,
  )

  return dirs
}

async function cleanupTestDir() {
  await rm(TEST_DIR, { recursive: true, force: true })
}

// Minimal mock context for running the task programmatically
function createMockContext(baseDir: string) {
  const logs: string[] = []
  return {
    logs,
    context: {
      config: { DIR_BASE: baseDir } as Record<string, unknown>,
      output: {
        log: (msg: string) => logs.push(msg),
        error: (msg: string) => logs.push(msg),
        warn: (msg: string) => logs.push(msg),
      },
      compositionDepth: 0,
    },
  }
}

test('markdown:sel --server queries GraphQL via HTTP', async () => {
  const given = 'a running server with test data and --server flag'
  const should = 'return results from the server'

  const dirs = await setupTestDir()

  // Start a server on a random port with MarkdownStore
  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths: dirs,
    enableFileWatcher: false,
    markdownStoreConfig: {
      peopleDirs: [dirs.people],
      orgDirs: [dirs.orgs],
    },
  })

  await server.start()

  try {
    const task = new MarkdownSelectorTask()
    const { context } = createMockContext(TEST_DIR)

    const result = await task.run({
      args: {
        graphql: '{ people { name path } }',
        server: `localhost:${server.port}`,
        dsl: undefined,
        raw: false,
        json: false,
        limit: undefined,
      },
      context,
      tasks: null,
      rawArgs: {},
    } as any)

    assert({
      given,
      should,
      actual: result.status,
      expected: 'success',
    })

    assert({
      given,
      should: 'return 1 person',
      actual: result.data?.count,
      expected: 1,
    })

    assert({
      given,
      should: 'return path containing alice.md',
      actual: result.data?.paths[0]?.includes('alice.md'),
      expected: true,
    })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('markdown:sel --server with org query', async () => {
  const given = 'a running server with org data'
  const should = 'return org results'

  const dirs = await setupTestDir()

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths: dirs,
    enableFileWatcher: false,
    markdownStoreConfig: {
      peopleDirs: [dirs.people],
      orgDirs: [dirs.orgs],
    },
  })

  await server.start()

  try {
    const task = new MarkdownSelectorTask()
    const { context } = createMockContext(TEST_DIR)

    const result = await task.run({
      args: {
        graphql: '{ orgs { name kind path } }',
        server: `localhost:${server.port}`,
        dsl: undefined,
        raw: false,
        json: false,
        limit: undefined,
      },
      context,
      tasks: null,
      rawArgs: {},
    } as any)

    assert({
      given,
      should: 'succeed',
      actual: result.status,
      expected: 'success',
    })

    assert({
      given,
      should: 'return 1 org',
      actual: result.data?.count,
      expected: 1,
    })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('markdown:sel --server with --json flag', async () => {
  const given = 'a --json flag with --server'
  const should = 'output JSON and include data in result'

  const dirs = await setupTestDir()

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths: dirs,
    enableFileWatcher: false,
    markdownStoreConfig: {
      peopleDirs: [dirs.people],
      orgDirs: [dirs.orgs],
    },
  })

  await server.start()

  try {
    const task = new MarkdownSelectorTask()
    const { logs, context } = createMockContext(TEST_DIR)

    const result = await task.run({
      args: {
        graphql: '{ people { name } }',
        server: `localhost:${server.port}`,
        dsl: undefined,
        raw: false,
        json: true,
        limit: undefined,
      },
      context,
      tasks: null,
      rawArgs: {},
    } as any)

    assert({
      given,
      should: 'output JSON to log',
      actual: logs.length > 0 && logs[0].includes('Alice Smith'),
      expected: true,
    })

    assert({
      given,
      should: 'include data in result',
      actual: result.data?.data != null,
      expected: true,
    })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('markdown:sel --server accepts --dsl via transpilation', async () => {
  const given = '--server with --dsl'
  const should = 'transpile DSL to GraphQL and query server'

  const dirs = await setupTestDir()

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths: dirs,
    enableFileWatcher: false,
    markdownStoreConfig: {
      peopleDirs: [dirs.people],
      orgDirs: [dirs.orgs],
    },
  })

  await server.start()

  try {
    const task = new MarkdownSelectorTask()
    const { context } = createMockContext(TEST_DIR)

    const result = await task.run({
      args: {
        dsl: 'person',
        server: `localhost:${server.port}`,
        graphql: undefined,
        raw: false,
        json: false,
        limit: undefined,
      },
      context,
      tasks: null,
      rawArgs: {},
    } as any)

    assert({
      given,
      should,
      actual: result.status,
      expected: 'success',
    })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('markdown:sel --server hoists misplaced filter args before execution', async () => {
  const given = 'a query with a filter key in field-argument position'
  const should = 'hoist it into where and return full results'

  const dirs = await setupTestDir()

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths: dirs,
    enableFileWatcher: false,
    markdownStoreConfig: {
      peopleDirs: [dirs.people],
      orgDirs: [dirs.orgs],
    },
  })

  await server.start()

  try {
    const task = new MarkdownSelectorTask()
    const { context, logs } = createMockContext(TEST_DIR)

    // Stored context queries from before the hoist existed replay through
    // markdown:sel; without normalization this fails validation ("Unknown
    // argument \"org\"") and salvage would drop the selection entirely.
    const result = await task.run({
      args: {
        graphql: '{ people(org: "Acme Corp") { name path } }',
        server: `localhost:${server.port}`,
        dsl: undefined,
        raw: false,
        json: false,
        limit: undefined,
      },
      context,
      tasks: null,
      rawArgs: {},
    } as any)

    assert({
      given,
      should,
      actual: result.status,
      expected: 'success',
    })

    assert({
      given,
      should: 'match the person the filter intended',
      actual: result.data?.paths[0]?.includes('alice.md'),
      expected: true,
    })

    assert({
      given,
      should: 'not drop any selection',
      actual: logs.some((l) => l.includes('Dropped invalid selection')),
      expected: false,
    })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})
