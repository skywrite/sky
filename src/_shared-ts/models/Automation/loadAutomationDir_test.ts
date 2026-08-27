import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { loadAutomationDir } from './loadAutomationDir.ts'

const VALID = `---
run: google:email:inbox:fetch
every: 5m
---

Keep followed mail current.
`

const ALSO_VALID = `---
run: ai:task
at: EVERY-MON 09:00
status: paused
---

Draft the weekly post.
`

const BROKEN = `---
run: day:start
at: EVERY-MONDAY 09:00
---

The pattern is a typo, so this charter cannot fire.
`

async function makeDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'automation-dir-test-'))
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(dir, name), contents)
  }
  return dir
}

test('loadAutomationDir - loads every charter by file name', async () => {
  const dir = await makeDir({ 'email-fetch.md': VALID, 'weekly-post.md': ALSO_VALID })

  try {
    const { byName, errors } = await loadAutomationDir(dir)

    assert({
      given: 'a directory of two valid charters',
      should: 'key them by file name with no errors',
      actual: { names: [...byName.keys()].sort(), errors: errors.length },
      expected: { names: ['email-fetch', 'weekly-post'], errors: 0 },
    })

    assert({
      given: 'a loaded charter',
      should: 'carry the parsed command and its path',
      actual: [byName.get('weekly-post')?.automation.run, path.basename(byName.get('weekly-post')?.path ?? '')],
      expected: ['ai:task', 'weekly-post.md'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadAutomationDir - one broken charter does not take the others down', async () => {
  const dir = await makeDir({ 'good.md': VALID, 'broken.md': BROKEN })

  try {
    const { byName, errors } = await loadAutomationDir(dir)

    assert({
      given: 'a directory holding one unreadable charter',
      should: 'load the good one and record the failure by path',
      actual: {
        loaded: [...byName.keys()],
        errorFiles: errors.map((e) => path.basename(e.path)),
        mentionsThePattern: errors[0]?.error.includes('EVERY-MONDAY') ?? false,
      },
      expected: { loaded: ['good'], errorFiles: ['broken.md'], mentionsThePattern: true },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadAutomationDir - skips a README and ignores non-markdown', async () => {
  const dir = await makeDir({
    'email-fetch.md': VALID,
    'README.md': '# What lives here\n\nNotes for humans, not a charter.\n',
    'notes.txt': 'not markdown',
  })

  try {
    const { byName, errors } = await loadAutomationDir(dir)

    assert({
      given: 'a directory with a README and a text file alongside a charter',
      should: 'load only the charter, without complaining',
      actual: { names: [...byName.keys()], errors: errors.length },
      expected: { names: ['email-fetch'], errors: 0 },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadAutomationDir - a missing directory means nothing is declared yet', async () => {
  const missing = path.join(tmpdir(), `automation-dir-absent-${process.pid}`)
  const { byName, errors } = await loadAutomationDir(missing)

  assert({
    given: 'a directory that does not exist',
    should: 'return empty rather than fail',
    actual: { size: byName.size, errors: errors.length },
    expected: { size: 0, errors: 0 },
  })
})
