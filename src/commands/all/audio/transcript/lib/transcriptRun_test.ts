import { readdir, utimes, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import {
  clearTranscriptRun,
  clockLabel,
  nextStep,
  peekTranscriptRun,
  sha256Of,
  STALE_DAYS,
  TranscriptRun,
  type RunStage,
} from './transcriptRun.ts'

const NOW = '2026-01-27 09:31'

async function world() {
  const root = await makeTempDir()
  const dir = path.join(root, 'runs')
  const memo = path.join(root, 'memo.m4a')
  await writeFile(memo, 'the same bytes')
  const clock = { now: NOW }
  const options = { dir, now: () => clock.now }
  return { root, dir, memo, clock, options }
}

test('a stage round-trips with the clock it was kept at', async () => {
  const { memo, options, clock } = await world()
  const run = await TranscriptRun.forFile(memo, options)

  assert({
    given: 'a fresh record',
    should: 'have nothing kept',
    actual: [await run.get('raw'), await run.started(), await run.resume()],
    expected: [null, null, null],
  })

  await run.put('raw', { text: 'Morning, everyone.', durationSeconds: 252, language: 'en' })
  clock.now = '2026-01-27 09:40'
  await run.put('analysis', { analysis: { issues: [], who: ['Jane Doe'] } })

  assert({
    given: 'two stages kept at different times',
    should: 'return each with its own stamp, and the run started at the first',
    actual: [await run.get('raw'), (await run.get('analysis'))?.at, await run.started()],
    expected: [
      { at: NOW, data: { text: 'Morning, everyone.', durationSeconds: 252, language: 'en' } },
      '2026-01-27 09:40',
      NOW,
    ],
  })
})

test('the same bytes share a record; different bytes do not', async () => {
  const { root, memo, options } = await world()
  const copy = path.join(root, 'renamed.m4a')
  await writeFile(copy, 'the same bytes')
  const other = path.join(root, 'other.m4a')
  await writeFile(other, 'other bytes')

  const a = await TranscriptRun.forFile(memo, options)
  const b = await TranscriptRun.forFile(copy, options)
  const c = await TranscriptRun.forFile(other, options)

  assert({
    given: 'a file, a renamed copy, and a different file',
    should: 'key the copy with the original and the other on its own',
    actual: [a.key === b.key, a.key === c.key, a.key.length],
    expected: [true, false, 64],
  })
})

test('resume() names the next step from what is done', async () => {
  const cases: Array<[RunStage[], string | null]> = [
    [[], null],
    [['raw'], 'Checking names'],
    [['raw', 'analysis'], 'Checking names'],
    [['analysis', 'review'], 'Writing it up'],
    [['review', 'writeup'], 'Writing it up'],
    [['writeup', 'extract'], 'Checking the write-up'],
    [['extract', 'filed'], 'Action items'],
  ]
  assert({
    given: 'each combination of kept stages',
    should: 'name the step the run would pick up at',
    actual: cases.map(([done]) => nextStep(done)),
    expected: cases.map(([, step]) => step),
  })

  const { memo, options } = await world()
  const run = await TranscriptRun.forFile(memo, options)
  await run.put('writeup', { summary: '## Meeting Summary\n\nPricing.' })
  assert({
    given: 'a record with the write-up kept',
    should: 'resume at the write-up with the time it started',
    actual: await run.resume(),
    expected: { step: 'Writing it up', started: NOW },
  })
})

test('clear() forgets the run, by the record or by its key', async () => {
  const { memo, options, dir } = await world()
  const run = await TranscriptRun.forFile(memo, options)
  await run.put('raw', { text: 'words' })
  await run.clear()
  assert({
    given: 'a cleared record',
    should: 'read as nothing kept and leave no directory',
    actual: [await run.get('raw'), await run.started(), await readdir(dir)],
    expected: [null, null, []],
  })

  await run.put('raw', { text: 'words again' })
  await clearTranscriptRun(run.key, { dir })
  assert({
    given: 'the key cleared from outside, as a door does when it files',
    should: 'leave nothing',
    actual: await readdir(dir),
    expected: [],
  })
})

test('a record untouched past STALE_DAYS is forgotten on open', async () => {
  const { memo, options } = await world()
  const run = await TranscriptRun.forFile(memo, options)
  await run.put('raw', { text: 'old words' })
  const ago = new Date(Date.now() - (STALE_DAYS + 1) * 24 * 60 * 60 * 1000)
  await utimes(path.join(run.dir, 'run.json'), ago, ago)

  const reopened = await TranscriptRun.forFile(memo, options)
  assert({
    given: 'a manifest last written before the stale window',
    should: 'open as an empty record',
    actual: [await reopened.get('raw'), await reopened.resume()],
    expected: [null, null],
  })

  await run.put('raw', { text: 'new words' })
  const fresh = await TranscriptRun.forFile(memo, options)
  assert({
    given: 'a record written just now',
    should: 'still be there',
    actual: (await fresh.get('raw'))?.data.text,
    expected: 'new words',
  })
})

test('a malformed stage file reads as not kept', async () => {
  const { memo, options } = await world()
  const run = await TranscriptRun.forFile(memo, options)
  await run.put('raw', { text: 'words' })
  await writeFile(path.join(run.dir, 'analysis.json'), '{ not json')
  await writeFile(path.join(run.dir, 'review.json'), JSON.stringify({ version: 2, at: NOW, data: {} }))
  assert({
    given: 'a stage file that is not JSON and one from another version',
    should: 'read both as null and keep the good one',
    actual: [await run.get('analysis'), await run.get('review'), (await run.get('raw'))?.data.text],
    expected: [null, null, 'words'],
  })
})

test('peekTranscriptRun() answers before anything runs', async () => {
  const { memo, options, dir } = await world()
  const key = await sha256Of(memo)
  assert({
    given: 'a file with no record',
    should: 'answer null',
    actual: await peekTranscriptRun(key, { dir }),
    expected: null,
  })
  const run = await TranscriptRun.forFile(memo, options)
  await run.put('raw', { text: 'words' })
  await run.put('analysis', { analysis: {} })
  await run.put('review', { corrections: [] })
  assert({
    given: 'a file whose names review is done',
    should: 'say the run picks up at the write-up',
    actual: [await peekTranscriptRun(key, { dir }), key === run.key],
    expected: [{ step: 'Writing it up', started: NOW }, true],
  })
})

test('clockLabel() shows the time alone on the same day', () => {
  assert({
    given: 'a stamp from today and one from another day',
    should: 'shorten only the one from today',
    actual: [clockLabel('2026-01-27 00:06', NOW), clockLabel('2026-01-26 23:50', NOW)],
    expected: ['00:06', '2026-01-26 23:50'],
  })
})
