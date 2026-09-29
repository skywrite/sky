import { spyOn } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { TranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { CommandResult } from '#commands/mod.ts'
import * as config from '#config'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { journalFromAudio } from './fromAudio.ts'
import * as journal from './recordedJournal.ts'

test('audio journal organization starts only after the shared transcription and correction command finishes', async () => {
  const base = await makeTempDir({ prefix: 'sky-audio-journal-order-' })
  const source = path.join(base, 'recording.m4a')
  await writeFile(source, 'mock audio')
  const when = new PlainDateTime('2031-03-16 08:00')
  const now = new ZonedDateTime(when, 'UTC')
  const context = CommandContext.test(config, { notebookNow: now, systemNow: now })
  const tasks = new CommandService(context)
  const run = await TranscriptRun.forFile(source, { dir: path.join(base, 'runs'), now: () => when.toString() })
  const order: string[] = []
  const clean = spyOn(tasks, 'run').mockImplementation(async (name, args) => {
    assert({
      given: 'an audio journal',
      should: 'use the existing cleaner with retry settings',
      actual: [name, args],
      expected: ['audio:transcript:clean', { fromAudio: source, fresh: false }],
    })
    order.push('transcribe', 'correct')
    return CommandResult.success({
      cleanedText: 'Jane Doe helped with Atlas.',
      who: [],
      rel: ['Jane Doe'],
      run: run.key,
      audioFilePath: source,
    })
  })
  const open = spyOn(TranscriptRun, 'open').mockResolvedValue(run)
  const file = spyOn(journal, 'fileRecordedJournal').mockImplementation(async (options) => {
    order.push('choose-types')
    assert({
      given: 'completed corrections',
      should: 'organize corrected speech and retain the original source',
      actual: [options.cleanedText, options.source, options.reviewTypes],
      expected: ['Jane Doe helped with Atlas.', source, true],
    })
    return CommandResult.success({ files: ['journal/Atlas.md'] })
  })
  try {
    const result = await journalFromAudio({
      fromAudio: source,
      when,
      types: [],
      split: 'auto',
      fresh: false,
      context,
      tasks,
    })
    assert({
      given: 'the composed pipeline',
      should: 'wait for cleaning before choosing types and return every file',
      actual: [order, result.data?.files],
      expected: [['transcribe', 'correct', 'choose-types'], ['journal/Atlas.md']],
    })
  } finally {
    file.mockRestore()
    open.mockRestore()
    clean.mockRestore()
    await rm(base, { recursive: true, force: true })
  }
})
