import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, makeTempDir, outputFile, readTextFile } from '#shared/fs/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import DayDirFileWriter from './DayDirFileWriter.ts'

test('DayDirFileWriter', async () => {
  const given = 'a file name that exists in the day dir'
  const should = 'create a new file'

  const tempDir = await makeTempDir()
  const day = new PlainDate(2022, 10, 29)
  const fileNames = ['meeting_blah.md', 'meeting_blah-2.md', 'meeting_blah-3.md']

  await outputFile(path.join(tempDir, dayDir(day), fileNames[0]), 'Meeting 1')
  await outputFile(path.join(tempDir, dayDir(day), fileNames[1]), 'Meeting 2')

  const df = new DayDirFileWriter(day, tempDir)

  const contents = 'Meeting 3'
  const fileWritten = await df.write(fileNames[2], contents)

  const file = path.join(tempDir, dayDir(day), fileNames[2])

  assert({
    given,
    should,
    expected: true,
    actual: await exists(file),
  })

  assert({
    given,
    should,
    expected: contents,
    actual: await readTextFile(file),
  })

  assert({
    given,
    should,
    expected: fileNames[2],
    actual: fileWritten,
  })

  //
  // case with file having a directory component
  //

  const fileWithDir = 'actions/messages/slack_bob.md'
  let contentsOfSlackFile = 'Slack w/ Bob'
  let fileWrittenSlack = await df.write(fileWithDir, contentsOfSlackFile)

  let expected = contentsOfSlackFile
  let actual = await readTextFile(path.join(df.fullDir, fileWrittenSlack))

  assert({ given, should, expected, actual })

  contentsOfSlackFile = 'Slack w/ Bob #2'
  fileWrittenSlack = await df.write(fileWithDir, contentsOfSlackFile)

  expected = contentsOfSlackFile
  actual = await readTextFile(path.join(df.fullDir, fileWrittenSlack))

  assert({ given, should, expected, actual })

  expected = 'actions/messages/slack_bob-2.md'
  actual = fileWrittenSlack

  assert({ given, should, expected, actual })
})

test('DayDirFileWriter reserves different files for concurrent captures with the same name', async () => {
  const tempDir = await makeTempDir()
  try {
    const writer = new DayDirFileWriter(new PlainDate(2026, 4, 10), tempDir)
    const contents = ['First thread', 'Second thread', 'Third thread', 'Fourth thread']
    const files = await Promise.all(contents.map((content) => writer.write('actions/messages/email_Atlas.md', content)))
    assert({
      given: 'four simultaneous captures requesting one filename',
      should: 'reserve four files and preserve every capture',
      actual: {
        uniqueFiles: new Set(files).size,
        contents: await Promise.all(files.map((file) => readTextFile(path.join(writer.fullDir, file)))),
      },
      expected: { uniqueFiles: 4, contents },
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
