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
import { journalFromTranscript, spokenText } from './fromTranscript.ts'
import * as journal from './recordedJournal.ts'
import { sectionsFromStarts } from './recordedSections.ts'

const CLIP_TURNS = '[00:00:01] Atlas went well today, and\n\n[00:00:04] then I walked home.'

test('spokenText gives the journal the words alone', () => {
  const starts = [{ heading: 'Atlas', firstWords: 'Atlas went well today, and then' }]
  assert({
    given: "a Zoom Clip's turn text, a stamp opening each cue",
    should: 'drop the stamps and run the cues together, so the quoted opening words are found',
    actual: [
      spokenText(CLIP_TURNS, []),
      sectionsFromStarts(CLIP_TURNS, starts),
      sectionsFromStarts(spokenText(CLIP_TURNS, []), starts)?.map((section) => section.body),
    ],
    expected: [
      'Atlas went well today, and then I walked home.',
      undefined,
      ['Atlas went well today, and then I walked home.'],
    ],
  })
  assert({
    given: 'one named speaker',
    should: 'drop the name: it is the person journaling',
    actual: spokenText('[00:00:01] Jane Doe: Atlas went well today.', ['Jane Doe']),
    expected: 'Atlas went well today.',
  })
  assert({
    given: 'two speakers',
    should: 'keep who said what, a turn to a paragraph, without the stamps',
    actual: spokenText('[00:00:01] Jane Doe: How was Atlas?\n\n[00:00:05] Alex Chen: It went well.', [
      'Jane Doe',
      'Alex Chen',
    ]),
    expected: 'Jane Doe: How was Atlas?\n\nAlex Chen: It went well.',
  })
})

test('a transcript journal is cleaned from its cues, never transcribed, and files with the transcript kept', async () => {
  const base = await makeTempDir({ prefix: 'sky-transcript-journal-' })
  const source = path.join(base, 'atlas-reflection.vtt')
  await writeFile(
    source,
    'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nAtlas went well today, and\n\n2\n00:00:04.000 --> 00:00:07.000\nthen I walked home.\n',
  )
  const when = new PlainDateTime('2031-03-16 08:00')
  const now = new ZonedDateTime(when, 'UTC')
  const context = CommandContext.test(config, { notebookNow: now, systemNow: now })
  const tasks = new CommandService(context)
  const run = await TranscriptRun.forFile(source, { dir: path.join(base, 'runs'), now: () => when.toString() })
  const clean = spyOn(tasks, 'run').mockImplementation(async (name, args) => {
    assert({
      given: 'a recorded journal dropped as its .vtt',
      should: 'clean the transcript file with the same pass, without transcribing',
      actual: [name, args],
      expected: ['audio:transcript:clean', { fromZoomVtt: source, fresh: false }],
    })
    return CommandResult.success({
      cleanedText: CLIP_TURNS,
      who: [],
      rel: ['Jane Doe'],
      run: run.key,
      audioFilePath: null,
      transcriptFilePath: source,
    })
  })
  const open = spyOn(TranscriptRun, 'open').mockResolvedValue(run)
  const file = spyOn(journal, 'fileRecordedJournal').mockImplementation(async (options) => {
    assert({
      given: "a Zoom Clip's cleaned turn text",
      should: 'organize the corrected words without stamps, review types, and keep the transcript as the source',
      actual: [options.kind, options.cleanedText, options.source, options.split, options.reviewTypes],
      expected: ['Transcript', 'Atlas went well today, and then I walked home.', source, 'auto', true],
    })
    return CommandResult.success({ files: ['journal/Atlas.md'] })
  })
  try {
    const result = await journalFromTranscript({ fromZoomVtt: source, when, fresh: false, context, tasks })
    assert({
      given: 'the composed pipeline',
      should: 'return every filed journal',
      actual: result.data?.files,
      expected: ['journal/Atlas.md'],
    })
  } finally {
    file.mockRestore()
    open.mockRestore()
    clean.mockRestore()
    await rm(base, { recursive: true, force: true })
  }
})
