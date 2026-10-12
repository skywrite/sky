import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('day:location creates the day file when the day has none', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'day-location-test-'))
  try {
    // Config is resolved on import, so a child process isolates the notebook.
    const result = await runCommand(
      'bun',
      [
        '--eval',
        `
      import { mock } from 'bun:test'
      import { strict as check } from 'node:assert'
      import { readDay } from '#shared/nbfs/mod.ts'
      import { PlainDate } from '#universal/dates/nbdt/mod.ts'
      mock.module('#commands/all/util/location/fetchGoogleGeocode.ts', () => ({
        fetchGoogleGeocode: async () => ({ results: [] }),
        assembleGoogleAddressComponents: () => ({}),
        buildPlacePath: () => 'places/France/Paris',
      }))
      const { default: Task } = await import('#commands/all/day/location.ts')
      const day = new PlainDate('2026-04-11')
      const set = await new Task().run({
        args: { day, lat: '48.85837', long: '2.294481', mobile: false },
        context: { env: {}, output: { log() {} } },
      })
      check.equal(set.ok, true, set.message)
      const saved = await readDay(day)
      check.equal(saved.started, undefined)
      check.equal(saved.location, 'places/France/Paris')
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given: 'a location set on a day that has no day file',
      should: 'create the day, unstarted, with the location',
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
