import { realpathSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer } from '#service/server.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { assert, test } from '#test'
import { FIXTURE_MARKDOWN_DIRS, FIXTURE_PATHS, FIXTURE_REFERENCE_DATE } from './fixtures/mod.ts'

// realpath so watcher/path comparisons see symlink-free paths (macOS /tmp and
// /var are symlinks into /private)
const TEST_DIR = path.join(realpathSync(os.tmpdir()), 'notebook-graphql-test')

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

  await writeFile(
    path.join(dirs.people, 'bob.md'),
    `---
name:
  - Bob
  - Robert Chen
org: Acme Corp
---

# Bob
`,
  )

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

test('GraphQL queries', async () => {
  const given = 'a tags query'
  const should = 'return array of tags'

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
    const url = `http://localhost:${server.port}/graphql`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ tags }' }),
    })

    const result = await response.json()
    const actual = Array.isArray(result.data.tags)
    const expected = true

    assert({ given, should, actual, expected })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('GraphQL queries', async () => {
  const given = 'a peopleNames query'
  const should = 'return array of people names'

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
    const url = `http://localhost:${server.port}/graphql`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ peopleNames }' }),
    })

    const result = await response.json()
    const actual = Array.isArray(result.data.peopleNames)
    const expected = true

    assert({ given, should, actual, expected })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('GraphQL queries', async () => {
  const given = 'an organizations query'
  const should = 'return array of organizations'

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
    const url = `http://localhost:${server.port}/graphql`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ organizations }' }),
    })

    const result = await response.json()
    const actual = Array.isArray(result.data.organizations)
    const expected = true

    assert({ given, should, actual, expected })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('GraphQL queries', async () => {
  const given = 'a tagsWithScores query over the fixture notebook'
  const should = "expose each tag's all-time fileCount and lastSeen"

  const server = createServer({
    port: 0,
    markdownDirs: FIXTURE_MARKDOWN_DIRS,
    paths: FIXTURE_PATHS,
    enableFileWatcher: false,
    referenceDate: FIXTURE_REFERENCE_DATE,
  })
  await server.start()

  try {
    const url = `http://localhost:${server.port}/graphql`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ tagsWithScores { name score lastSeen fileCount } }' }),
    })

    const result = (await response.json()) as {
      data: { tagsWithScores: Array<{ name: string; score: number; lastSeen: string | null; fileCount: number }> }
    }
    // Work/Engineering appears in three dated fixture files, latest 2026-01-27
    const engineering = result.data.tagsWithScores.find((t) => t.name === 'Work/Engineering')
    const actual = { fileCount: engineering?.fileCount, lastSeen: engineering?.lastSeen }
    const expected = { fileCount: 3, lastSeen: '2026-01-27' }

    assert({ given, should, actual, expected })
  } finally {
    server.stop()
  }
})

test('GraphQL subscriptions', async () => {
  const given = 'a WebSocket connection request'
  const should = 'upgrade to WebSocket with graphql-transport-ws protocol'

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
    const wsUrl = `ws://localhost:${server.port}/graphql`
    const ws = new WebSocket(wsUrl, 'graphql-transport-ws')

    const actual = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        ws.close()
        resolve(false)
      }, 5000)

      ws.onopen = () => {
        clearTimeout(timeout)
        ws.close()
      }
      ws.onclose = () => {
        resolve(true)
      }
      ws.onerror = () => {
        clearTimeout(timeout)
        ws.close()
      }
    })

    const expected = true

    assert({ given, should, actual, expected })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('GraphQL subscriptions', async () => {
  const given = 'a connection_init message'
  const should = 'respond with connection_ack'

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
    const wsUrl = `ws://localhost:${server.port}/graphql`
    const ws = new WebSocket(wsUrl, 'graphql-transport-ws')

    const actual = await new Promise<string>((resolve) => {
      let result = 'timeout'
      const timeout = setTimeout(() => {
        ws.close()
      }, 5000)

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'connection_init' }))
      }

      ws.onmessage = (event) => {
        clearTimeout(timeout)
        const message = JSON.parse(event.data.toString())
        result = message.type
        ws.close()
      }

      ws.onclose = () => {
        resolve(result)
      }

      ws.onerror = () => {
        clearTimeout(timeout)
        result = 'error'
        ws.close()
      }
    })

    const expected = 'connection_ack'

    assert({ given, should, actual, expected })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('GraphQL subscriptions', async () => {
  const given = 'a subscription request for tagsUpdated'
  const should = 'accept the subscription without error'

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
    const wsUrl = `ws://localhost:${server.port}/graphql`
    const ws = new WebSocket(wsUrl, 'graphql-transport-ws')

    const actual = await new Promise<boolean>((resolve) => {
      let result = false
      let mainTimeout: ReturnType<typeof setTimeout> | undefined
      let subTimeout: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        if (mainTimeout) clearTimeout(mainTimeout)
        if (subTimeout) clearTimeout(subTimeout)
        ws.close()
      }

      mainTimeout = setTimeout(() => {
        cleanup()
      }, 5000)

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'connection_init' }))
      }

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data.toString())

        if (message.type === 'connection_ack') {
          // Send subscription
          ws.send(
            JSON.stringify({
              id: 'test-sub',
              type: 'subscribe',
              payload: {
                query: 'subscription { tagsUpdated }',
              },
            }),
          )

          // If no error after 1 second, consider it successful
          subTimeout = setTimeout(() => {
            result = true
            cleanup()
          }, 1000)
        } else if (message.type === 'error') {
          result = false
          cleanup()
        }
      }

      ws.onclose = () => {
        resolve(result)
      }

      ws.onerror = () => {
        result = false
        cleanup()
      }
    })

    const expected = true

    assert({ given, should, actual, expected })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('GraphQL subscriptions real-time', async () => {
  const given = 'a store update event'
  const should = 'receive subscription update via WebSocket'

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
    const wsUrl = `ws://localhost:${server.port}/graphql`
    const ws = new WebSocket(wsUrl, 'graphql-transport-ws')

    const actual = await new Promise<boolean>((resolve) => {
      let result = false
      let mainTimeout: ReturnType<typeof setTimeout> | undefined
      let subTimeout: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        if (mainTimeout) clearTimeout(mainTimeout)
        if (subTimeout) clearTimeout(subTimeout)
        ws.close()
      }

      mainTimeout = setTimeout(() => {
        cleanup()
      }, 5000)

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'connection_init' }))
      }

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data.toString())

        if (message.type === 'connection_ack') {
          ws.send(
            JSON.stringify({
              id: 'real-time-test',
              type: 'subscribe',
              payload: {
                query: 'subscription { tagsUpdated }',
              },
            }),
          )

          // Subscription is set up successfully
          subTimeout = setTimeout(() => {
            result = true
            cleanup()
          }, 500)
        }
      }

      ws.onclose = () => {
        resolve(result)
      }

      ws.onerror = () => {
        result = false
        cleanup()
      }
    })

    const expected = true

    assert({ given, should, actual, expected })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

/**
 * Every subscription the VS Code extension opens must actually deliver.
 *
 * The handler dispatches on substring matches against the query text, and an
 * unmatched field registers no listener at all — the client sees a healthy
 * connection that simply never pushes. `tagsWithScoresUpdated` was unmatched
 * from this file's first commit, so editor tag completions only ever refreshed
 * on reconnect. Asserting delivery, rather than that the subscribe was
 * accepted, is what distinguishes the two.
 */
test('GraphQL subscriptions deliver', async () => {
  const given = 'every subscription the editor opens, and a store update for each'
  const should = 'push a payload for all of them'

  // Mirrors CompletionDataStore.setupSubscriptions() in extensions/vscode.
  const subscriptions: Array<[string, string]> = [
    ['tags', 'tagsUpdated'],
    ['people', 'peopleUpdated'],
    ['organizations', 'organizationsUpdated'],
    ['peopleWithScores', 'peopleWithScoresUpdated { name score }'],
    ['tagsWithScores', 'tagsWithScoresUpdated { name score }'],
  ]

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
    const ws = new WebSocket(`ws://localhost:${server.port}/graphql`, 'graphql-transport-ws')
    const delivered = new Set<string>()

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(finish, 5000)

      function finish() {
        clearTimeout(timeout)
        ws.close()
        resolve()
      }

      ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }))

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data.toString())

        if (message.type === 'connection_ack') {
          for (const [id, field] of subscriptions) {
            ws.send(
              JSON.stringify({
                id,
                type: 'subscribe',
                payload: { query: `subscription { ${field} }` },
              }),
            )
          }

          // Let every subscribe register before driving the store.
          setTimeout(() => {
            server.store.update('tags', TagSet.fromArray(['atlas']))
            server.store.update('people', new Set(['Jane Doe']))
            server.store.update('organizations', new Set(['Atlas']))
            server.store.emitPersonScoresUpdated()
            server.store.emitTagScoresUpdated()
          }, 100)
        }

        if (message.type === 'next') delivered.add(message.id)
        if (delivered.size === subscriptions.length) finish()
      }

      ws.onerror = finish
    })

    const actual = subscriptions.map(([id]) => id).filter((id) => !delivered.has(id))
    const expected: string[] = []

    assert({ given, should, actual, expected })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

// ---------------------------------------------------------------------------
// Document read/write — documentContent + saveDocument
// ---------------------------------------------------------------------------

/** POST one GraphQL operation and return the parsed body. */
async function gql(port: number, query: string, variables?: Record<string, unknown>) {
  const response = await fetch(`http://localhost:${port}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  return (await response.json()) as { data?: any; errors?: Array<{ message: string }> }
}

const READ_DOC = 'query($path: String!) { documentContent(path: $path) { path content version } }'
const SAVE_DOC = `mutation($path: String!, $content: String!, $version: Float, $force: Boolean) {
  saveDocument(path: $path, content: $content, version: $version, force: $force) {
    saved conflict message document { path content version }
  }
}`

test('GraphQL documents - read, conflict-checked save, and force share the REST version semantics', async () => {
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
    // Paths are relative to the common ancestor of the markdown dirs.
    const alicePath = path.relative(path.dirname(TEST_DIR), path.join(dirs.people, 'alice.md'))

    const read = await gql(server.port, READ_DOC, { path: alicePath })
    assert({
      given: 'a documentContent read of an existing profile',
      should: 'return the file with a version handle',
      actual: {
        path: read.data.documentContent.path,
        hasContent: read.data.documentContent.content.includes('Alice Smith'),
        versionIsNumber: typeof read.data.documentContent.version === 'number',
      },
      expected: { path: alicePath, hasContent: true, versionIsNumber: true },
    })

    const staleVersion = read.data.documentContent.version
    const edited = read.data.documentContent.content + '\n## Overview\n\nEngineer at Acme.\n'
    const save = await gql(server.port, SAVE_DOC, { path: alicePath, content: edited, version: staleVersion })
    assert({
      given: 'a save carrying the version it read',
      should: 'write the file and return the fresh snapshot',
      actual: {
        saved: save.data.saveDocument.saved,
        conflict: save.data.saveDocument.conflict,
        versionMoved: save.data.saveDocument.document.version !== staleVersion,
      },
      expected: { saved: true, conflict: false, versionMoved: true },
    })

    const conflicted = await gql(server.port, SAVE_DOC, {
      path: alicePath,
      content: 'overwrite attempt',
      version: staleVersion,
    })
    assert({
      given: 'a save carrying a version the previous save invalidated',
      should: 'refuse as a conflict and hand back the current disk snapshot',
      actual: {
        saved: conflicted.data.saveDocument.saved,
        conflict: conflicted.data.saveDocument.conflict,
        currentContent: conflicted.data.saveDocument.document.content === edited,
      },
      expected: { saved: false, conflict: true, currentContent: true },
    })

    const forced = await gql(server.port, SAVE_DOC, {
      path: alicePath,
      content: edited + '\nForced line.\n',
      version: staleVersion,
      force: true,
    })
    assert({
      given: 'the same stale version with force',
      should: 'overwrite anyway',
      actual: forced.data.saveDocument.saved,
      expected: true,
    })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('GraphQL documents - scope gating and missing files', async () => {
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
    const escape = await gql(server.port, READ_DOC, { path: '../../etc/hosts.md' })
    assert({
      given: 'a path escaping the notebook base directory',
      should: 'error rather than read',
      actual: { errored: (escape.errors?.length ?? 0) > 0, data: escape.data?.documentContent ?? null },
      expected: { errored: true, data: null },
    })

    const missingPath = path.relative(path.dirname(TEST_DIR), path.join(dirs.people, 'nobody.md'))
    const missing = await gql(server.port, READ_DOC, { path: missingPath })
    assert({
      given: 'a scoped path with no file behind it',
      should: 'return null, distinct from an error',
      actual: { doc: missing.data.documentContent, errored: (missing.errors?.length ?? 0) > 0 },
      expected: { doc: null, errored: false },
    })

    const create = await gql(server.port, SAVE_DOC, { path: missingPath, content: '# Nobody\n' })
    assert({
      given: 'a save aimed at a file that does not exist',
      should: 'refuse — saveDocument edits, never creates',
      actual: create.errors?.[0]?.message,
      expected: `Document not found: ${missingPath}`,
    })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})

test('GraphQL documents - allPeople carries the name list, preferred entry first', async () => {
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
    const result = await gql(server.port, '{ allPeople { name names path } }')
    const people = [...result.data.allPeople].sort((a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name),
    )
    assert({
      given: 'a scalar-name profile and a list-name profile (preferred first, legal second)',
      should: 'serialize both with full alias lists — the aliases live in the name: list itself',
      actual: people.map((p: { name: string; names: string[] }) => ({ name: p.name, names: p.names })),
      expected: [
        { name: 'Alice Smith', names: ['Alice Smith'] },
        { name: 'Bob', names: ['Bob', 'Robert Chen'] },
      ],
    })
  } finally {
    server.stop()
    await cleanupTestDir()
  }
})
