import { assert, test } from '#test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { createServer, type PathConfig } from './server.ts'

const TEST_DIR = '/private/tmp/notebook-rebuild-test'

async function setupTestDir(): Promise<PathConfig> {
  await rm(TEST_DIR, { recursive: true, force: true })

  const dirs = {
    people: path.join(TEST_DIR, 'people'),
    peopleOld: path.join(TEST_DIR, 'people-old'),
    orgs: path.join(TEST_DIR, 'orgs'),
    projects: path.join(TEST_DIR, 'projects'),
    places: path.join(TEST_DIR, 'places'),
    time: path.join(TEST_DIR, 'time'),
  }

  for (const dir of Object.values(dirs)) {
    await mkdir(dir, { recursive: true })
  }

  return dirs
}

async function cleanupTestDir() {
  await rm(TEST_DIR, { recursive: true, force: true })
}

function orgMarkdown(name: string): string {
  return `---\nname: ${name}\n---\n\n# ${name}\n`
}

test('rebuildEntityStores applies file removals the incremental scan cannot', async () => {
  const paths = await setupTestDir()
  // The incident shape: an org file in a nested category dir
  const nestedDir = path.join(paths.orgs, 'tech', 'devtools')
  await mkdir(nestedDir, { recursive: true })
  const removedOrgFile = path.join(nestedDir, 'Acme-Widgets.md')
  await writeFile(removedOrgFile, orgMarkdown('Acme Widgets'))
  await writeFile(path.join(paths.orgs, 'Keep-Corp.md'), orgMarkdown('Keep Corp'))

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
  })
  await server.scan()

  assert({
    given: 'the initial scan',
    should: 'index both orgs',
    actual: server.store.organizations.has('Acme Widgets') && server.store.organizations.has('Keep Corp'),
    expected: true,
  })

  await rm(removedOrgFile)

  let updateEventFired = false
  server.store.once('organizationsUpdated', () => {
    updateEventFired = true
  })

  await server.rebuildEntityStores()

  assert({
    given: 'a rebuild after the org file was deleted',
    should: 'drop the removed org from the entity store',
    actual: server.store.organizations.has('Acme Widgets'),
    expected: false,
  })

  assert({
    given: 'a rebuild after the org file was deleted',
    should: 'keep the surviving org',
    actual: server.store.organizations.has('Keep Corp'),
    expected: true,
  })

  assert({
    given: 'a rebuild',
    should: 'emit organizationsUpdated so subscribers refresh',
    actual: updateEventFired,
    expected: true,
  })

  await cleanupTestDir()
})

test('rebuildEntityStores is idempotent — repeated rebuilds do not drift', async () => {
  const paths = await setupTestDir()
  await writeFile(path.join(paths.orgs, 'Keep-Corp.md'), orgMarkdown('Keep Corp'))

  const server = createServer({
    port: 0,
    markdownDirs: [TEST_DIR],
    paths,
    enableFileWatcher: false,
  })
  await server.scan()
  await server.rebuildEntityStores()
  await server.rebuildEntityStores()

  assert({
    given: 'two consecutive rebuilds',
    should: 'leave exactly the on-disk orgs',
    actual: Array.from(server.store.organizations),
    expected: ['Keep Corp'],
  })

  await cleanupTestDir()
})
