import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'

test('video:new writes a parseable day link for a platform with spaces', async () => {
  const temp = await makeTempDir({ prefix: 'video-new-test-' })
  try {
    // The command reads configuration on import; keep all writes in an isolated notebook.
    const result = await runCommand(
      'bun',
      [
        '--eval',
        `
      import { strict as check } from 'node:assert'
      import { readFile } from 'node:fs/promises'
      import * as path from 'node:path'
      import { Lexer } from 'marked'
      import Task from '#commands/all/video/new.ts'
      import CommandContext from '#commands/lib/core/CommandContext.ts'
      import * as config from '#config'
      import DayDocument from '#shared/models/Day/document/mod.ts'
      import { dayFile } from '#shared/nbfs/mod.ts'
      import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
      import { buildDayRecord } from '#service/handler/day/record.ts'

      const when = new PlainDateTime('2026-01-27 09:30')
      const created = await new Task().run({
        args: { from: 'Jane Doe', to: 'Alex Atlas', summary: 'Atlas review', medium: 'Zoom Clip', when, category: 'Professional Complete' },
        context: CommandContext.test(config),
      })
      check.equal(created.ok, true, created.message)
      const dayPath = path.join(config.DIR_TIME, dayFile(when.plainDate))
      const markdown = await readFile(dayPath, 'utf8')
      const day = DayDocument.fromMarkdown(markdown)
      const entries = day.lists.find(list => list.title === 'Professional Complete').items
      check.equal(entries.length, 1)
      const links = Lexer.lexInline(entries[0]).filter(token => token.type === 'link')
      const relativePath = path.relative(path.dirname(dayPath), created.data.filePath)
      check.ok(relativePath.includes('Zoom Clip_'))
      check.deepEqual(links.map(link => ({ text: link.text, href: link.href })), [{ text: 'Atlas review', href: relativePath }])
      const record = await buildDayRecord({
        day: when.plainDate, timeDir: config.DIR_TIME, dayDirPath: path.dirname(dayPath),
        markdownBaseDir: config.DIR_BASE, ownerNames: ['Alex Atlas'],
      })
      check.equal(record.videos.length, 1)
      check.equal(record.videos[0].title, 'Atlas review')
      check.deepEqual(record.done, [])
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given: 'a Zoom Clip captured through the command in an isolated notebook',
      should: 'write a valid link to the saved video and avoid repeating it in Done',
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
