import { CommandPlatform } from '#commands/mod.ts'
import type { OpenSavedFilesOptions } from '#lib/shell/openSavedFiles.ts'
import { assert, test } from '#test'
import type { FetchedThread } from '../../lib/fetchUnsavedThreads.ts'
import { MAX_EDITOR_OPENS, openCapturedEntries } from './sync.ts'

const thread = (threadId: string, paths: string[]): FetchedThread => ({
  threadId,
  from: 'Jane Doe',
  subject: `Thread ${threadId}`,
  messages: paths.map((p) => ({ date: '2031-03-16', path: p })),
  captured: paths.length,
})

test('openCapturedEntries opens first captures on Server and all captures on Console according to openSavedIn', async () => {
  const calls: Array<{ files: readonly string[]; options?: OpenSavedFilesOptions }> = []
  const logs: string[] = []
  const threads = [
    thread('t1', ['time/2031/W11/03-16/email_first.md']),
    thread('t2', ['time/2031/W11/03-16/email_reply.md']),
  ]

  await openCapturedEntries({
    platform: CommandPlatform.Server,
    noEditor: false,
    allThreads: threads,
    firstCaptures: new Set(['t1']),
    baseDir: '/home/jane/Sky',
    port: 9999,
    output: { log: (msg) => logs.push(msg) },
    target: 'browser',
    openFiles: async (files, options) => {
      calls.push({ files, options })
      return { target: 'browser', opened: files.length }
    },
  })

  await openCapturedEntries({
    platform: CommandPlatform.Console,
    noEditor: false,
    allThreads: threads,
    firstCaptures: new Set(['t1']),
    baseDir: '/home/jane/Sky',
    port: 9999,
    output: { log: (msg) => logs.push(msg) },
    target: 'code',
    openFiles: async (files, options) => {
      calls.push({ files, options })
      return { target: 'code', opened: files.length }
    },
  })

  assert({
    given: 'Server with browser mode and Console with code mode',
    should: 'open only first captures on Server and every capture on Console with the configured target',
    actual: [calls, logs],
    expected: [
      [
        {
          files: ['time/2031/W11/03-16/email_first.md'],
          options: { target: 'browser', baseDir: '/home/jane/Sky', port: 9999 },
        },
        {
          files: ['time/2031/W11/03-16/email_first.md', 'time/2031/W11/03-16/email_reply.md'],
          options: { target: 'code', baseDir: '/home/jane/Sky', port: 9999 },
        },
      ],
      ['  Opening 1 captured entry in browser', '  Opening 2 captured entries in code editor'],
    ],
  })
})

test('openCapturedEntries skips opening when target is none, --no-editor is set, or platform is Test', async () => {
  let called = 0
  const logs: string[] = []
  const threads = [thread('t1', ['time/2031/W11/03-16/email_first.md'])]
  const openFiles = async () => {
    called++
    return { target: 'browser' as const, opened: 1 }
  }

  for (const scenario of [
    { platform: CommandPlatform.Server, noEditor: false, target: 'none' as const },
    { platform: CommandPlatform.Console, noEditor: true, target: 'browser' as const },
    { platform: CommandPlatform.Test, noEditor: false, target: 'browser' as const },
  ]) {
    await openCapturedEntries({
      ...scenario,
      allThreads: threads,
      firstCaptures: new Set(['t1']),
      baseDir: '/home/jane/Sky',
      port: 9999,
      output: { log: (msg) => logs.push(msg) },
      openFiles,
    })
  }

  assert({
    given: 'target=none, --no-editor, or CommandPlatform.Test',
    should: 'log nothing and skip opening',
    actual: [called, logs],
    expected: [0, []],
  })
})

test('openCapturedEntries caps opens and logs a warning instead of throwing on opener errors', async () => {
  const opened: string[][] = []
  const logs: string[] = []
  const many = Array.from({ length: MAX_EDITOR_OPENS + 2 }, (_, i) => `time/2031/W11/03-16/email_${i}.md`)

  await openCapturedEntries({
    platform: CommandPlatform.Console,
    noEditor: false,
    allThreads: [thread('t1', many)],
    firstCaptures: new Set(['t1']),
    baseDir: '/home/jane/Sky',
    port: 9999,
    output: { log: (msg) => logs.push(msg) },
    target: 'browser',
    openFiles: async (files) => {
      opened.push([...files])
      throw new Error('opener failed')
    },
  })

  assert({
    given: 'more captures than MAX_EDITOR_OPENS and a failing opener',
    should: 'cap the opened list and warn without throwing',
    actual: [opened[0].length, logs],
    expected: [
      MAX_EDITOR_OPENS,
      [
        `  Opening ${MAX_EDITOR_OPENS} captured entries in browser (2 more listed in the report below)`,
        '  Warning: could not open captured entries (opener failed)',
      ],
    ],
  })
})
