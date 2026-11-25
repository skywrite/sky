import { assert, test } from '#test'
import { explorerFileUrl, openSavedFiles, toNotebookRelativePath } from './openSavedFiles.ts'

const baseConfig = (
  overrides: Partial<{ dir: string; editor?: string; openSavedIn?: 'browser' | 'code' | 'none'; port: number }> = {},
) => ({
  dir: overrides.dir ?? '/home/jane/Sky',
  editor: overrides.editor ?? 'code',
  openSavedIn: overrides.openSavedIn,
  server: { port: overrides.port ?? 9999 },
})

test('openSavedFiles defaults to browser Explorer tabs with deduplicated, encoded local URLs on macOS', async () => {
  const runs: string[][] = []
  const result = await openSavedFiles(
    [
      'time/2031/W11/03-16/email_Jane_Atlas & Plan.md',
      '/home/jane/Sky/time/2031/W11/03-16/slack_Atlas_Launch?#.md',
      'time/2031/W11/03-16/email_Jane_Atlas & Plan.md',
    ],
    {
      platform: 'darwin',
      loadConfig: () => baseConfig({ port: 4321 }),
      run: async (command, args = []) => {
        runs.push([command, ...args])
        return { success: true, code: 0, stdout: '', stderr: '' }
      },
    },
  )

  assert({
    given: 'relative and absolute notebook paths with duplicates and URL punctuation',
    should: 'open distinct local Explorer URLs through macOS open',
    actual: [result, runs],
    expected: [
      { target: 'browser', opened: 2 },
      [
        [
          'open',
          'http://localhost:4321/explorer/time/2031/W11/03-16/email_Jane_Atlas%20%26%20Plan.md',
          'http://localhost:4321/explorer/time/2031/W11/03-16/slack_Atlas_Launch%3F%23.md',
        ],
      ],
    ],
  })
})

test('openSavedFiles opens each Explorer URL via openUrl on non-macOS platforms', async () => {
  const urls: string[] = []
  const result = await openSavedFiles(['time/2031/W11/03-16/a.md', 'time/2031/W11/03-16/b.md'], {
    platform: 'linux',
    loadConfig: () => baseConfig({ openSavedIn: 'browser', port: 5555 }),
    openUrl: async (url) => {
      urls.push(url)
    },
  })

  assert({
    given: 'browser mode on Linux',
    should: 'open each distinct Explorer URL through openUrl',
    actual: [result, urls],
    expected: [
      { target: 'browser', opened: 2 },
      [
        'http://localhost:5555/explorer/time/2031/W11/03-16/a.md',
        'http://localhost:5555/explorer/time/2031/W11/03-16/b.md',
      ],
    ],
  })
})

test('openSavedFiles opens absolute file paths in the configured code editor when set to code', async () => {
  const editorCalls: Array<{ files: Array<{ file: string }>; editor?: string }> = []
  const result = await openSavedFiles(
    ['time/2031/W11/03-16/email_Jane_Atlas.md', '/home/jane/Sky/time/2031/W11/03-16/slack_Atlas.md'],
    {
      loadConfig: () => baseConfig({ openSavedIn: 'code', editor: 'cursor' }),
      openInEditor: async (files, editor) => {
        editorCalls.push({ files, editor })
      },
    },
  )

  assert({
    given: 'openSavedIn set to code with cursor configured',
    should: 'open the resolved disk paths in that editor',
    actual: [result, editorCalls],
    expected: [
      { target: 'code', opened: 2 },
      [
        {
          files: [
            { file: '/home/jane/Sky/time/2031/W11/03-16/email_Jane_Atlas.md' },
            { file: '/home/jane/Sky/time/2031/W11/03-16/slack_Atlas.md' },
          ],
          editor: 'cursor',
        },
      ],
    ],
  })
})

test('openSavedFiles does nothing when set to none or given no files', async () => {
  let launches = 0
  const none = await openSavedFiles(['time/2031/W11/03-16/a.md'], {
    platform: 'darwin',
    loadConfig: () => baseConfig({ openSavedIn: 'none' }),
    run: async () => {
      launches++
      return { success: true, code: 0, stdout: '', stderr: '' }
    },
    openInEditor: async () => {
      launches++
    },
    openUrl: async () => {
      launches++
    },
  })
  const empty = await openSavedFiles([], {
    platform: 'darwin',
    loadConfig: () => baseConfig({ openSavedIn: 'browser' }),
    run: async () => {
      launches++
      return { success: true, code: 0, stdout: '', stderr: '' }
    },
  })

  assert({
    given: 'openSavedIn set to none, or an empty file list',
    should: 'return zero opened without spawning any process',
    actual: [none, empty, launches],
    expected: [{ target: 'none', opened: 0 }, { target: 'browser', opened: 0 }, 0],
  })
})

test('openSavedFiles rejects paths outside the notebook or with traversal segments before launching', async () => {
  let launches = 0
  const invalid = ['', '../escape.md', 'time/./a.md', '/etc/passwd']
  const rejected = await Promise.all(
    invalid.map((file) =>
      openSavedFiles([file], {
        platform: 'darwin',
        loadConfig: () => baseConfig({ openSavedIn: 'browser' }),
        run: async () => {
          launches++
          return { success: true, code: 0, stdout: '', stderr: '' }
        },
      }).then(
        () => false,
        () => true,
      ),
    ),
  )

  assert({
    given: 'empty, traversing, or out-of-notebook paths',
    should: 'reject every path without launching the OS opener',
    actual: [rejected, launches, toNotebookRelativePath('./time/2031/a.md', '/home/jane/Sky')],
    expected: [[true, true, true, true], 0, 'time/2031/a.md'],
  })
})

test('openSavedFiles reports macOS open failures cleanly', async () => {
  const error = await openSavedFiles(['time/2031/W11/03-16/a.md'], {
    platform: 'darwin',
    loadConfig: () => baseConfig({ openSavedIn: 'browser' }),
    run: async () => ({ success: false, code: 1, stdout: '', stderr: 'browser unavailable' }),
  }).then(
    () => null,
    (err: Error) => err.message,
  )

  assert({
    given: 'a failing macOS open command',
    should: 'throw with the stderr message',
    actual: [error, explorerFileUrl('time/2031/W11/03-16/a.md', 9999)],
    expected: ['browser unavailable', 'http://localhost:9999/explorer/time/2031/W11/03-16/a.md'],
  })
})
