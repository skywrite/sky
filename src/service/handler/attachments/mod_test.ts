import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import dayDir from '#shared/nbfs/dayDir.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { attachmentCandidates, attachmentDestination, safeAttachmentName, storeAttachment } from './mod.ts'

const DAY = new PlainDate('2026-03-05')
const DAY_DOC = path.posix.join('time', dayDir(DAY), 'standup.md')

test({ name: 'attachments - a day document keeps its files in the day attachments' }, () => {
  assert({
    given: 'a document inside a day directory of the time tree',
    should: "point at that day's attachments directory and name the day",
    actual: attachmentDestination(DAY_DOC, '/media'),
    expected: { dir: '/media/attachments/2026/03/05', day: '2026-03-05' },
  })
  assert({
    given: 'a file named beside that document',
    should: 'be looked for in the mirror first, then in the day attachments',
    actual: attachmentCandidates(path.posix.join('time', dayDir(DAY), 'chart.png'), '/media'),
    expected: [`/media/time/${dayDir(DAY)}/chart.png`, '/media/attachments/2026/03/05/chart.png'],
  })
})

test({ name: 'attachments - any other document keeps its files in the mirror of its directory' }, () => {
  assert({
    given: 'a document under library/',
    should: 'point at the same directory under the user-data directory, with no day',
    actual: attachmentDestination('library/guides/spreadsheets.md', '/media'),
    expected: { dir: '/media/library/guides' },
  })
  assert({
    given: 'a file named beside it',
    should: 'be looked for in the mirror only',
    actual: attachmentCandidates('library/guides/chart.png', '/media'),
    expected: ['/media/library/guides/chart.png'],
  })
})

test({ name: 'attachments - a file name is reduced to a safe last segment' }, () => {
  assert({
    given: 'names with directories, a hidden-file dot, control characters, or nothing at all',
    should: 'keep only a visible, plain last segment',
    actual: [
      '../../etc/passwd',
      'C:\\Users\\jane\\.secret.png',
      'a\u0000b:c.pdf',
      '   ',
      'Screenshot 2026-03-05 at 9.41.12.png',
    ].map(safeAttachmentName),
    expected: ['passwd', 'secret.png', 'a-b-c.pdf', 'file', 'Screenshot 2026-03-05 at 9.41.12.png'],
  })
})

test({ name: 'attachments - storing copies the bytes, deduplicating by content' }, async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'sky-attachments-'))
  try {
    const first = await storeAttachment({
      userDataDir,
      relativePath: DAY_DOC,
      name: 'notes.txt',
      data: Buffer.from('one'),
    })
    const again = await storeAttachment({
      userDataDir,
      relativePath: DAY_DOC,
      name: 'notes.txt',
      data: Buffer.from('one'),
    })
    const other = await storeAttachment({
      userDataDir,
      relativePath: DAY_DOC,
      name: 'notes.txt',
      data: Buffer.from('two'),
    })
    const mirror = await storeAttachment({
      userDataDir,
      relativePath: 'library/guides/x.md',
      name: '../sub/notes.txt',
      data: Buffer.from('three'),
    })
    const dayDirPath = path.join(userDataDir, 'attachments', '2026', '03', '05')
    assert({
      given: 'the same file twice, then a different file under the same name, for a day document',
      should: 'keep one copy under the name, give the different file _2, and name the day',
      actual: [first, again, other],
      expected: [
        { file: 'notes.txt', day: '2026-03-05' },
        { file: 'notes.txt', day: '2026-03-05' },
        { file: 'notes_2.txt', day: '2026-03-05' },
      ],
    })
    assert({
      given: 'the copies on disk',
      should: 'hold the bytes that arrived',
      actual: [
        await readFile(path.join(dayDirPath, 'notes.txt'), 'utf8'),
        await readFile(path.join(dayDirPath, 'notes_2.txt'), 'utf8'),
        await readFile(path.join(userDataDir, 'library', 'guides', 'notes.txt'), 'utf8'),
      ],
      expected: ['one', 'two', 'three'],
    })
    assert({
      given: 'a file for a document under library/, named with a directory in front',
      should: 'land in the mirror of the document directory under its bare name, with nothing staged left behind',
      actual: [mirror, (await readdir(path.join(userDataDir, 'tmp'))).length],
      expected: [{ file: 'notes.txt' }, 0],
    })
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})
