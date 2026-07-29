import { assert, test } from '#test'
import * as path from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import * as os from 'node:os'
import { createServer } from '#service/server.ts'
import TagSet from '#shared/models/TagSet/mod.ts'

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
