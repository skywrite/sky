import * as path from 'node:path'
import { parseDecisionMoment, writeDecision, SlugCollisionError } from '#commands/all/decisions/lib/write.ts'
import { makeTempDir, readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

const NOW = new ZonedDateTime('2026-03-05 09:15', 'America/Chicago')

test('writeDecision - writes the document under pending/ keyed to notebook now', async () => {
  const decisionsDir = await makeTempDir({ prefix: 'decisions-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const result = await writeDecision(
    {
      name: 'Choose-Vendor',
      title: 'Choose Vendor',
      context: 'Two vendors are in play.',
      desiredOutcomes: 'A signed contract.',
      target: '2026-03-20',
      rel: ['Atlas'],
      now: NOW,
      category: 'Professional Complete',
    },
    { decisionsDir, timeDir },
  )

  assert({
    actual: result.file,
    expected: path.join(decisionsDir, '2026', 'pending', '03', 'Choose-Vendor.md'),
  })

  const content = await readTextFile(result.file)
  assert({ actual: content.includes('name: Choose-Vendor'), expected: true })
  assert({ actual: content.includes('created: 2026-03-05'), expected: true })
  assert({ actual: content.includes('target: 2026-03-20'), expected: true })
  assert({ actual: content.includes('- Atlas'), expected: true })
  assert({ actual: content.includes('# Choose Vendor'), expected: true })

  assert({
    actual: result.dayItem,
    expected: '09:15 > decisions/Choose-Vendor -> Identified | Choose Vendor',
  })
})

test('writeDecision - a made call lands resolved with the Decision section filled', async () => {
  const decisionsDir = await makeTempDir({ prefix: 'decisions-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const result = await writeDecision(
    {
      name: 'Ship-Widget',
      title: 'Ship Widget in the next release',
      context: 'The build is done and gated on one signature.',
      desiredOutcomes: 'Widget live without incident.',
      decision: 'Widget ships flagged off; config flips on signature.',
      now: NOW,
      category: 'Professional Complete',
    },
    { decisionsDir, timeDir },
  )

  assert({
    given: 'a decision that was already made',
    should: 'land under resolved/, not pending/',
    actual: result.file,
    expected: path.join(decisionsDir, '2026', 'resolved', '03', 'Ship-Widget.md'),
  })

  const content = await readTextFile(result.file)
  assert({ actual: content.includes('resolved: 2026-03-05'), expected: true })
  assert({ actual: content.includes('target:'), expected: true })
  assert({
    given: 'the made call',
    should: 'fill the Decision section',
    actual: content.includes('Widget ships flagged off; config flips on signature.'),
    expected: true,
  })

  assert({
    given: 'a resolved-at-birth decision',
    should: 'record a Decided day item, not Identified',
    actual: result.dayItem,
    expected: '09:15 > decisions/Ship-Widget -> Decided | Ship Widget in the next release',
  })
})

test('writeDecision - refuses a slug collision instead of overwriting', async () => {
  const decisionsDir = await makeTempDir({ prefix: 'decisions-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const input = {
    name: 'Choose-Vendor',
    title: 'Choose Vendor',
    context: 'First write.',
    desiredOutcomes: 'Outcomes.',
    now: NOW,
    category: 'Professional Complete',
  }

  await writeDecision(input, { decisionsDir, timeDir })

  let thrown: unknown
  try {
    await writeDecision({ ...input, context: 'Second write.' }, { decisionsDir, timeDir })
  } catch (err) {
    thrown = err
  }

  assert({ actual: thrown instanceof SlugCollisionError, expected: true })

  const content = await readTextFile(path.join(decisionsDir, '2026', 'pending', '03', 'Choose-Vendor.md'))
  assert({
    given: 'a colliding second write',
    should: 'leave the first document untouched',
    actual: content.includes('First write.'),
    expected: true,
  })
})

test('writeDecision - a made call that still binds lands in in-force/ with the flag', async () => {
  const decisionsDir = await makeTempDir({ prefix: 'decisions-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })
  const base = {
    title: 'No releases on Fridays',
    context: 'Two Friday releases needed weekend fixes with nobody on call.',
    desiredOutcomes: 'No weekend fixes.',
    now: NOW,
    category: 'Professional Complete',
  }

  const inForce = await writeDecision(
    {
      ...base,
      name: 'No-Friday-Releases',
      decision: 'No releases on Fridays, until the on-call rota is staffed.',
      inForce: true,
    },
    { decisionsDir, timeDir },
  )
  const unmade = await writeDecision({ ...base, name: 'Friday-Policy', inForce: true }, { decisionsDir, timeDir })
  const content = await readTextFile(inForce.file)

  assert({
    given: 'a made decision marked in force, and an open one wrongly marked in force',
    should:
      'file the first under in-force/ with the flag and a Decided day item, and leave the second pending without it',
    actual: {
      file: inForce.file,
      flag: content.includes('\ninForce: true\n'),
      resolved: content.includes('resolved: 2026-03-05'),
      dayItem: inForce.dayItem,
      unmade: unmade.file,
      unmadeFlag: (await readTextFile(unmade.file)).includes('inForce'),
    },
    expected: {
      file: path.join(decisionsDir, '2026', 'in-force', '03', 'No-Friday-Releases.md'),
      flag: true,
      resolved: true,
      dayItem: '09:15 > decisions/No-Friday-Releases -> Decided | No releases on Fridays',
      unmade: path.join(decisionsDir, '2026', 'pending', '03', 'Friday-Policy.md'),
      unmadeFlag: false,
    },
  })
})

test('parseDecisionMoment - a date with a time, a date alone, and anything else', () => {
  const read = (value: string) => {
    const moment = parseDecisionMoment(value)
    return moment ? `${moment.date} ${moment.time}` : undefined
  }

  assert({
    given: 'a date and time, a bare date, padding, a month that does not exist, and words',
    should: 'keep the time given, read a bare date as noon, and refuse what is not a real moment',
    actual: [
      read('2025-03-10 15:00'),
      read('2025-03-10'),
      read('  2025-03-10 9:05 '),
      read('2025-13-10'),
      read('last spring'),
    ],
    expected: ['2025-03-10 15:00', '2025-03-10 12:00', '2025-03-10 09:05', undefined, undefined],
  })
})

test('writeDecision - a decision recorded after the fact keeps its own day and says when it was written', async () => {
  const decisionsDir = await makeTempDir({ prefix: 'decisions-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const result = await writeDecision(
    {
      name: 'No-Friday-Releases',
      title: 'No releases on Fridays',
      context: 'Two Friday releases needed weekend fixes with nobody on call.',
      desiredOutcomes: 'No weekend fixes.',
      decision: 'No releases on Fridays, until the on-call rota is staffed.',
      inForce: true,
      now: new ZonedDateTime('2025-03-10 15:00', 'America/New_York'),
      recorded: new PlainDate('2026-03-05'),
      category: 'Professional Complete',
    },
    { decisionsDir, timeDir },
  )
  const content = await readTextFile(result.file)

  assert({
    given: 'a decision made on 2025-03-10 and written down on 2026-03-05',
    should: 'file and date it by the day it was made, and stamp only `updated` with the day it was written',
    actual: {
      file: result.file,
      identified: content.includes('identified: 2025-03-10 15:00-04:00[America/New_York]'),
      resolved: content.includes('resolved: 2025-03-10 15:00-04:00[America/New_York]'),
      created: content.includes('\ncreated: 2025-03-10\n'),
      updated: content.includes('\nupdated: 2026-03-05\n'),
      dayItem: result.dayItem,
    },
    expected: {
      file: path.join(decisionsDir, '2025', 'in-force', '03', 'No-Friday-Releases.md'),
      identified: true,
      resolved: true,
      created: true,
      updated: true,
      dayItem: '15:00 > decisions/No-Friday-Releases -> Decided | No releases on Fridays',
    },
  })
})
