import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir, readDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { copyFileDedup, copyToDayAttachments } from './attachments.ts'

const DAY = new PlainDate('2026-01-27')

async function tmp(): Promise<string> {
  return makeTempDir({ prefix: 'sky-attachments-' })
}

async function names(dir: string): Promise<string[]> {
  const out: string[] = []
  for await (const entry of readDir(dir)) out.push(entry.name)
  return out.sort()
}

test('copyFileDedup - same content reuses the name, different content numbers it', async () => {
  const src = await tmp()
  const attachDir = await tmp()
  const brief = path.join(src, 'brief.pdf')
  const other = path.join(src, 'other.pdf')
  await writeFile(brief, '%PDF brief')
  await writeFile(other, '%PDF other')

  const first = await copyFileDedup(brief, attachDir, '2026-01-27_Chat_brief.pdf')
  const again = await copyFileDedup(brief, attachDir, '2026-01-27_Chat_brief.pdf')
  const clash = await copyFileDedup(other, attachDir, '2026-01-27_Chat_brief.pdf')
  const clashAgain = await copyFileDedup(other, attachDir, '2026-01-27_Chat_brief.pdf')

  assert({
    given: 'the same file copied twice, then a different file wanting the same name, twice',
    should: 'keep one copy per content: the name, then _2, each reused on repeat',
    actual: { first, again, clash, clashAgain, files: await names(attachDir) },
    expected: {
      first: '2026-01-27_Chat_brief.pdf',
      again: '2026-01-27_Chat_brief.pdf',
      clash: '2026-01-27_Chat_brief_2.pdf',
      clashAgain: '2026-01-27_Chat_brief_2.pdf',
      files: ['2026-01-27_Chat_brief.pdf', '2026-01-27_Chat_brief_2.pdf'],
    },
  })

  assert({
    given: 'a source that does not exist',
    should: 'copy nothing and return undefined',
    actual: await copyFileDedup(path.join(src, 'missing.pdf'), attachDir, 'x.pdf'),
    expected: undefined,
  })
})

test('copyToDayAttachments - creates the day directory and returns the attachment ref', async () => {
  const src = await tmp()
  const root = await tmp()
  const brief = path.join(src, 'brief.pdf')
  await writeFile(brief, '%PDF brief')

  const copied = await copyToDayAttachments({
    sourcePath: brief,
    attachmentsRoot: root,
    day: DAY,
    fileName: '2026-01-27_Chat_brief.pdf',
  })

  const expectedPath = path.join(root, '2026', '01', '27', '2026-01-27_Chat_brief.pdf')
  assert({
    given: 'a file and a day',
    should: 'copy it under YYYY/MM/DD and reference it by filename',
    actual: {
      copied,
      content: await readFile(expectedPath, 'utf8'),
    },
    expected: {
      copied: { attachment: { file: '2026-01-27_Chat_brief.pdf' }, path: expectedPath },
      content: '%PDF brief',
    },
  })
})

test('copyToDayAttachments - a source already in the day directory is referenced, not copied', async () => {
  const root = await tmp()
  const dayDir = path.join(root, '2026', '01', '27')
  await mkdir(dayDir, { recursive: true })
  const existing = path.join(dayDir, '2026-01-27_Slack_deck.pdf')
  await writeFile(existing, '%PDF deck')

  const copied = await copyToDayAttachments({
    sourcePath: existing,
    attachmentsRoot: root,
    day: DAY,
    fileName: '2026-01-27_Chat_2026-01-27_Slack_deck.pdf',
  })

  assert({
    given: 'a source that already lives in the day attachments',
    should: 'return it as it is, leaving the directory unchanged',
    actual: { copied, files: await names(dayDir) },
    expected: {
      copied: { attachment: { file: '2026-01-27_Slack_deck.pdf' }, path: existing },
      files: ['2026-01-27_Slack_deck.pdf'],
    },
  })

  assert({
    given: 'a missing source',
    should: 'return undefined',
    actual: await copyToDayAttachments({
      sourcePath: path.join(root, 'nope.pdf'),
      attachmentsRoot: root,
      day: DAY,
      fileName: 'nope.pdf',
    }),
    expected: undefined,
  })
})
