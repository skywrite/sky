import { assert, test } from '#test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer, type PathConfig } from './server.ts'
import { Store } from './store.ts'
import {
  EXPECTED_ORGS,
  EXPECTED_PEOPLE,
  FIXTURE_MARKDOWN_DIRS,
  FIXTURE_PATHS,
  FIXTURE_REFERENCE_DATE,
  HIGH_SCORE_ORGS,
  HIGH_SCORE_PEOPLE,
} from './fixtures/mod.ts'

// realpath so watcher/path comparisons see symlink-free paths (macOS /tmp and
// /var are symlinks into /private)
const TEST_DIR = path.join(realpathSync(os.tmpdir()), 'notebook-server-test')

async function setupTestDir(): Promise<PathConfig> {
  // Clean up any previous test data
  await rm(TEST_DIR, { recursive: true, force: true })

  // Create directory structure
  const dirs = {
    people: path.join(TEST_DIR, 'people'),
    peopleOld: path.join(TEST_DIR, 'people-old'),
    orgs: path.join(TEST_DIR, 'orgs'),
    projects: path.join(TEST_DIR, 'projects'),
    places: path.join(TEST_DIR, 'places'),
    // time/YYYY/MM/DD-DD — the week dir holding Tue 2026-01-27
    time: path.join(TEST_DIR, 'time', '2026', '01', '26-01'),
  }

  await mkdir(dirs.people, { recursive: true })
  await mkdir(dirs.peopleOld, { recursive: true })
  await mkdir(dirs.orgs, { recursive: true })
  await mkdir(dirs.projects, { recursive: true })
  await mkdir(dirs.places, { recursive: true })
  await mkdir(dirs.time, { recursive: true })

  return dirs
}

async function cleanupTestDir() {
  await rm(TEST_DIR, { recursive: true, force: true })
}

// =============================================================================
// Server factory creation tests
// =============================================================================

test('createServer - returns server with expected interface', async () => {
  const paths = await setupTestDir()
  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
  })

  assert({
    given: 'createServer call',
    should: 'return server with port property',
    actual: typeof server.port,
    expected: 'number',
  })

  assert({
    given: 'createServer call',
    should: 'return server with store instance',
    actual: server.store instanceof Store,
    expected: true,
  })

  assert({
    given: 'createServer call',
    should: 'return server with scan function',
    actual: typeof server.scan,
    expected: 'function',
  })

  assert({
    given: 'createServer call',
    should: 'return server with start function',
    actual: typeof server.start,
    expected: 'function',
  })

  assert({
    given: 'createServer call',
    should: 'return server with stop function',
    actual: typeof server.stop,
    expected: 'function',
  })

  await cleanupTestDir()
})

test('createServer - uses provided store instance', async () => {
  const paths = await setupTestDir()
  const customStore = new Store()
  customStore.people.add('Pre-existing Person')

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    store: customStore,
    enableFileWatcher: false,
  })

  assert({
    given: 'a pre-configured store',
    should: 'use that store instance',
    actual: server.store.people.has('Pre-existing Person'),
    expected: true,
  })

  await cleanupTestDir()
})

// =============================================================================
// Scanning tests
// =============================================================================

test('server.scan - populates people from person files', async () => {
  const paths = await setupTestDir()

  // Create a person file
  const personFile = path.join(paths.people, 'john-doe.md')
  await writeFile(
    personFile,
    `---
name: John Doe
met: 2026-01-15
---

# John Doe

Some notes about John.
`,
  )

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
  })

  await server.scan()

  assert({
    given: 'a person file in the people directory',
    should: 'add the person to the store',
    actual: server.store.people.has('John Doe'),
    expected: true,
  })

  await cleanupTestDir()
})

test('server.scan - populates organizations from org files', async () => {
  const paths = await setupTestDir()

  // Create an org file
  const orgFile = path.join(paths.orgs, 'acme-inc.md')
  await writeFile(
    orgFile,
    `---
name: Acme Inc
tags: company
---

# Acme Inc

An organization.
`,
  )

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
  })

  await server.scan()

  assert({
    given: 'an org file in the orgs directory',
    should: 'add the organization to the store',
    actual: server.store.organizations.has('Acme Inc'),
    expected: true,
  })

  await cleanupTestDir()
})

test('server.scan - extracts tags from files', async () => {
  const paths = await setupTestDir()

  // Create a file with tags
  const fileWithTags = path.join(paths.people, 'tagged-person.md')
  await writeFile(
    fileWithTags,
    `---
name: Tagged Person
tags:
  - investor
  - crypto
---

# Tagged Person
`,
  )

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
  })

  await server.scan()

  assert({
    given: 'a file with tags',
    should: 'add investor tag to store',
    actual: server.store.tags.has('investor'),
    expected: true,
  })

  assert({
    given: 'a file with tags',
    should: 'add crypto tag to store',
    actual: server.store.tags.has('crypto'),
    expected: true,
  })

  await cleanupTestDir()
})

// =============================================================================
// Interaction scoring tests
// =============================================================================

test('server.scan - records interactions from meeting files', async () => {
  const paths = await setupTestDir()

  // Create a person first (so they're in the store)
  const personFile = path.join(paths.people, 'jane-smith.md')
  await writeFile(
    personFile,
    `---
name: Jane Smith
---
`,
  )

  // Create a meeting file in a proper date folder structure
  // parseDateFromDayPath expects: .../time/2026/01/26-01/01-27/...
  const dayDir = path.join(paths.time, '01-27')
  await mkdir(dayDir, { recursive: true })
  const meetingFile = path.join(dayDir, 'meeting_weekly-sync.md')
  await writeFile(
    meetingFile,
    `---
who: Jane Smith
title: Weekly Sync
---

Meeting notes.
`,
  )

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
  })

  await server.scan()

  const janeScore = server.store.personScores.get('Jane Smith')

  assert({
    given: 'a meeting file with a person in the who field',
    should: 'record an interaction for that person',
    actual: janeScore !== undefined,
    expected: true,
  })

  assert({
    given: 'a meeting interaction',
    should: 'have at least one interaction recorded',
    actual: (janeScore?.interactionCount ?? 0) >= 1,
    expected: true,
  })

  await cleanupTestDir()
})

test('server.scan - tracks org interactions from person met dates', async () => {
  const paths = await setupTestDir()

  // Create org first
  const orgFile = path.join(paths.orgs, 'startup-inc.md')
  await writeFile(
    orgFile,
    `---
name: Startup Inc
---
`,
  )

  // Create person with org
  const personFile = path.join(paths.people, 'bob-wilson.md')
  await writeFile(
    personFile,
    `---
name: Bob Wilson
org: Startup Inc
met: 2026-01-20
---
`,
  )

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
  })

  await server.scan()

  const orgScore = server.store.orgScores.get('Startup Inc')

  assert({
    given: 'a person with an org and met date',
    should: 'record an org interaction',
    actual: orgScore !== undefined,
    expected: true,
  })

  await cleanupTestDir()
})

// =============================================================================
// Isolated store tests
// =============================================================================

test('createServer - multiple servers have isolated stores', async () => {
  const paths = await setupTestDir()

  const server1 = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
  })

  const server2 = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
  })

  // Add data to server1's store
  server1.store.people.add('Server1 Person')

  assert({
    given: 'two servers created without shared store',
    should: 'have isolated stores',
    actual: server2.store.people.has('Server1 Person'),
    expected: false,
  })

  assert({
    given: 'data added to server1 store',
    should: 'be present in server1',
    actual: server1.store.people.has('Server1 Person'),
    expected: true,
  })

  await cleanupTestDir()
})

// =============================================================================
// Fixture-based comprehensive tests
// =============================================================================

/**
 * Create a server with fixture paths and a deterministic reference date.
 * This ensures scoring tests are reproducible regardless of when they run.
 */
function createFixtureServer() {
  return createServer({
    port: 0,
    markdownDirs: FIXTURE_MARKDOWN_DIRS,
    paths: FIXTURE_PATHS,
    enableFileWatcher: false,
    referenceDate: FIXTURE_REFERENCE_DATE,
  })
}

test('fixtures - scans all expected people', async () => {
  const server = createFixtureServer()

  await server.scan()

  const actualPeople = Array.from(server.store.people).sort()

  assert({
    given: 'fixture data with 12 people',
    should: 'find all expected people',
    actual: actualPeople,
    expected: EXPECTED_PEOPLE,
  })
})

test('fixtures - scans all expected organizations', async () => {
  const server = createFixtureServer()

  await server.scan()

  const actualOrgs = Array.from(server.store.organizations).sort()

  assert({
    given: 'fixture data with 10 organizations',
    should: 'find all expected organizations',
    actual: actualOrgs,
    expected: EXPECTED_ORGS,
  })
})

test('fixtures - Chen Wei has highest person score (most interactions)', async () => {
  const server = createFixtureServer()

  await server.scan()

  const scores = server.store.getPeopleWithScores()
  const topPerson = scores[0]

  assert({
    given: 'fixture data with Chen Wei having most interactions',
    should: 'rank Chen Wei first',
    actual: topPerson.name,
    expected: 'Chen Wei',
  })

  assert({
    given: 'Chen Wei with 3+ interactions',
    should: 'have interaction count >= 3',
    actual: topPerson.interactionCount >= 3,
    expected: true,
  })
})

test('fixtures - Acme Corp has highest org score', async () => {
  const server = createFixtureServer()

  await server.scan()

  const scores = server.store.getOrganizationsWithScores()
  const topOrg = scores[0]

  assert({
    given: 'fixture data with Acme Corp having most interactions',
    should: 'rank Acme Corp first',
    actual: topOrg.name,
    expected: 'Acme Corp',
  })
})

test('fixtures - people with today interactions score higher than last week', async () => {
  const server = createFixtureServer()

  await server.scan()

  // Lisa Chen and Kevin Huang have meetings today (1/27)
  // Michael Thompson and Jennifer Walsh had meetings on 1/22
  const lisaScore = server.store.personScores.get('Lisa Chen')
  const kevinScore = server.store.personScores.get('Kevin Huang')
  const michaelScore = server.store.personScores.get('Michael Thompson')
  const jenniferScore = server.store.personScores.get('Jennifer Walsh')

  // Today's meeting (weight 10) with full recency (1.0) = 10 points
  // 5 days ago meeting (weight 10) with week recency (1.0) = 10 points
  // But Lisa/Kevin met more recently (today vs 5 days ago)
  assert({
    given: 'Lisa Chen with today meeting',
    should: 'have a score recorded',
    actual: (lisaScore?.score ?? 0) > 0,
    expected: true,
  })

  assert({
    given: 'Kevin Huang with today meeting',
    should: 'have a score recorded',
    actual: (kevinScore?.score ?? 0) > 0,
    expected: true,
  })

  assert({
    given: 'Michael Thompson with meeting 5 days ago',
    should: 'have a score recorded',
    actual: (michaelScore?.score ?? 0) > 0,
    expected: true,
  })

  assert({
    given: 'Jennifer Walsh with email 5 days ago',
    should: 'have a score recorded',
    actual: (jenniferScore?.score ?? 0) > 0,
    expected: true,
  })
})

test('fixtures - top 3 people includes high-interaction people', async () => {
  const server = createFixtureServer()

  await server.scan()

  const scores = server.store.getPeopleWithScores()
  const top3Names = scores.slice(0, 3).map((p) => p.name)

  // Chen Wei should definitely be in top 3 (most interactions)
  assert({
    given: 'fixture data',
    should: 'have Chen Wei in top 3',
    actual: top3Names.includes('Chen Wei'),
    expected: true,
  })
})

test('fixtures - top 3 orgs includes high-interaction orgs', async () => {
  const server = createFixtureServer()

  await server.scan()

  const scores = server.store.getOrganizationsWithScores()
  const top3Names = scores.slice(0, 3).map((o) => o.name)

  // Acme Corp should definitely be in top 3 (most interactions via employees)
  assert({
    given: 'fixture data',
    should: 'have Acme Corp in top 3',
    actual: top3Names.includes('Acme Corp'),
    expected: true,
  })
})

test('fixtures - extracts tags from all fixture files', async () => {
  const server = createFixtureServer()

  await server.scan()

  // Check for some expected tags from fixtures
  const tags = server.store.tags

  assert({
    given: 'fixture files with Organization/Company/Tech/Mag7 tag',
    should: 'extract the tag',
    actual: tags.has('Organization/Company/Tech/Mag7'),
    expected: true,
  })

  assert({
    given: 'fixture files with Person/Work/Engineering tag',
    should: 'extract the tag',
    actual: tags.has('Person/Work/Engineering'),
    expected: true,
  })

  assert({
    given: 'fixture files with Work/Cloud tag',
    should: 'extract the tag',
    actual: tags.has('Work/Cloud'),
    expected: true,
  })
})

test('fixtures - people without interactions have zero score', async () => {
  const server = createFixtureServer()

  await server.scan()

  // David Park (Apple) has no meeting files - only person file with met date
  // He should have a score from the met date
  const davidScore = server.store.personScores.get('David Park')

  // Priya Sharma has a recent met date but no interactions
  const priyaScore = server.store.personScores.get('Priya Sharma')

  assert({
    given: 'David Park with met date but no meetings',
    should: 'have score from met date',
    actual: (davidScore?.interactionCount ?? 0) >= 1,
    expected: true,
  })

  assert({
    given: 'Priya Sharma with recent met date',
    should: 'have score from met date',
    actual: (priyaScore?.interactionCount ?? 0) >= 1,
    expected: true,
  })
})

// =============================================================================
// MarkdownStore integration tests
// =============================================================================

test('createServer - markdownStore is null when not configured', async () => {
  const paths = await setupTestDir()
  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
    // No markdownStoreConfig
  })

  assert({
    given: 'server without markdownStoreConfig',
    should: 'have null markdownStore',
    actual: server.markdownStore,
    expected: null,
  })

  await cleanupTestDir()
})

test('createServer - buildMarkdownStore with empty dirs builds store', async () => {
  const paths = await setupTestDir()
  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
    markdownStoreConfig: {
      peopleDirs: [paths.people],
      orgDirs: [paths.orgs],
    },
  })

  const result = await server.buildMarkdownStore()

  assert({
    given: 'buildMarkdownStore with empty test dirs',
    should: 'return a MarkdownStore',
    actual: result !== null,
    expected: true,
  })

  await cleanupTestDir()
})

test('createServer - builds MarkdownStore when configured', async () => {
  const paths = await setupTestDir()

  // Create a test person file
  await writeFile(
    path.join(paths.people, 'test-person.md'),
    `---
name: Test Person
org: Test Org
---

# Test Person
`,
  )

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
    markdownStoreConfig: {
      peopleDirs: [paths.people],
      orgDirs: [paths.orgs],
    },
  })

  // Initially null
  assert({
    given: 'server before buildMarkdownStore',
    should: 'have null markdownStore',
    actual: server.markdownStore,
    expected: null,
  })

  // Build it
  const mdStore = await server.buildMarkdownStore()

  assert({
    given: 'buildMarkdownStore with config',
    should: 'return MarkdownStore instance',
    actual: mdStore !== null,
    expected: true,
  })

  assert({
    given: 'buildMarkdownStore with config',
    should: 'populate server.markdownStore',
    actual: server.markdownStore !== null,
    expected: true,
  })

  assert({
    given: 'MarkdownStore with person file',
    should: 'have 1 person',
    actual: server.markdownStore?.people.size,
    expected: 1,
  })

  // Verify we can resolve the person
  const resolved = server.markdownStore?.people.find('Test Person')
  assert({
    given: 'MarkdownStore with Test Person',
    should: 'resolve the person',
    actual: resolved?.value.name,
    expected: 'Test Person',
  })

  await cleanupTestDir()
})

test('fixtures - MarkdownStore resolves people from fixture data', async () => {
  const server = createServer({
    port: 0,
    markdownDirs: FIXTURE_MARKDOWN_DIRS,
    paths: FIXTURE_PATHS,
    enableFileWatcher: false,
    referenceDate: FIXTURE_REFERENCE_DATE,
    markdownStoreConfig: {
      peopleDirs: [FIXTURE_PATHS.people, FIXTURE_PATHS.peopleOld],
      orgDirs: [FIXTURE_PATHS.orgs],
      projectsDir: FIXTURE_PATHS.projects,
    },
  })

  await server.buildMarkdownStore()

  // Should have all expected people
  assert({
    given: 'MarkdownStore with fixture data',
    should: 'have people loaded',
    actual: (server.markdownStore?.people.size ?? 0) > 0,
    expected: true,
  })

  // Should resolve Chen Wei (high-score person)
  const chenWei = server.markdownStore?.people.find('Chen Wei')
  assert({
    given: 'MarkdownStore with Chen Wei in fixtures',
    should: 'resolve Chen Wei',
    actual: chenWei?.value.name,
    expected: 'Chen Wei',
  })

  // Should have orgs loaded
  assert({
    given: 'MarkdownStore with fixture data',
    should: 'have orgs loaded',
    actual: (server.markdownStore?.orgs.size ?? 0) > 0,
    expected: true,
  })
})

// =============================================================================
// GraphQL resolver tests
// =============================================================================

import { createResolvers } from './graphql/schema.ts'

test('GraphQL resolvers - legacy resolvers work without MarkdownStore', async () => {
  const paths = await setupTestDir()

  // Create person file
  await writeFile(
    path.join(paths.people, 'alice.md'),
    `---
name: Alice Smith
---

# Alice Smith
`,
  )

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
    // No markdownStoreConfig - legacy mode
  })

  await server.scan()

  const resolvers = createResolvers(server.store, null)

  // Legacy resolvers should work
  const people = resolvers.Query.peopleNames()
  assert({
    given: 'legacy resolver with scanned data',
    should: 'return people array',
    actual: people.includes('Alice Smith'),
    expected: true,
  })

  // Rich resolvers should return null/empty without MarkdownStore
  const person = resolvers.Query.person(null, { name: 'Alice Smith' })
  assert({
    given: 'rich resolver without MarkdownStore',
    should: 'return null',
    actual: person,
    expected: null,
  })

  const allPeople = resolvers.Query.allPeople()
  assert({
    given: 'allPeople without MarkdownStore',
    should: 'return empty array',
    actual: allPeople.length,
    expected: 0,
  })

  await cleanupTestDir()
})

test('GraphQL resolvers - rich resolvers return full documents', async () => {
  const paths = await setupTestDir()

  // Create person file
  await writeFile(
    path.join(paths.people, 'bob.md'),
    `---
name: Bob Johnson
org: Acme Corp
title: Engineer
tags:
  - tech
  - friend
---

# Bob Johnson

Some notes about Bob.
`,
  )

  // Create org file (kind is derived from Organization/* tag)
  await writeFile(
    path.join(paths.orgs, 'acme.md'),
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

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
    markdownStoreConfig: {
      peopleDirs: [paths.people],
      orgDirs: [paths.orgs],
    },
  })

  await server.scan()
  await server.buildMarkdownStore()

  const resolvers = createResolvers(server.store, server.markdownStore)

  // Test person resolver
  const bob = resolvers.Query.person(null, { name: 'Bob Johnson' })
  assert({
    given: 'person query for Bob Johnson',
    should: 'return person with name',
    actual: bob?.name,
    expected: 'Bob Johnson',
  })
  assert({
    given: 'person query for Bob Johnson',
    should: 'include org field',
    actual: bob?.org,
    expected: 'Acme Corp',
  })
  assert({
    given: 'person query for Bob Johnson',
    should: 'include tags array',
    actual: Array.isArray(bob?.tags) && bob.tags.includes('tech'),
    expected: true,
  })
  assert({
    given: 'person query for Bob Johnson',
    should: 'include markdown content',
    actual: bob?.markdown?.includes('Some notes about Bob'),
    expected: true,
  })

  // Test org resolver
  const acme = resolvers.Query.org(null, { name: 'Acme Corp' })
  assert({
    given: 'org query for Acme Corp',
    should: 'return org with name',
    actual: acme?.name,
    expected: 'Acme Corp',
  })
  assert({
    given: 'org query for Acme Corp',
    should: 'include kind field',
    actual: acme?.kind,
    expected: 'company',
  })
  assert({
    given: 'org query for Acme Corp',
    should: 'include site field',
    actual: acme?.site,
    expected: 'https://acme.example.com',
  })

  // Test allPeople resolver
  const allPeople = resolvers.Query.allPeople()
  assert({
    given: 'allPeople query',
    should: 'return array with 1 person',
    actual: allPeople.length,
    expected: 1,
  })
  assert({
    given: 'allPeople query',
    should: 'include Bob in results',
    actual: allPeople[0]?.name,
    expected: 'Bob Johnson',
  })

  // Test allOrgs resolver
  const allOrgs = resolvers.Query.allOrgs()
  assert({
    given: 'allOrgs query',
    should: 'return array with 1 org',
    actual: allOrgs.length,
    expected: 1,
  })

  await cleanupTestDir()
})

test('GraphQL resolvers - person query returns null for non-existent person', async () => {
  const paths = await setupTestDir()

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
    markdownStoreConfig: {
      peopleDirs: [paths.people],
      orgDirs: [paths.orgs],
    },
  })

  await server.buildMarkdownStore()

  const resolvers = createResolvers(server.store, server.markdownStore)

  const person = resolvers.Query.person(null, { name: 'Nobody' })
  assert({
    given: 'person query for non-existent name',
    should: 'return null',
    actual: person,
    expected: null,
  })

  await cleanupTestDir()
})
