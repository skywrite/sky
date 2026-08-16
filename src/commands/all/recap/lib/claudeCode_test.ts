import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import scanClaudeSessions, { type ClaudeSession, renderClaudeCodeRecap, topDirs } from './claudeCode.ts'
import type { SessionDigest } from './sessionDigest.ts'

const WINDOW = { start: new Date('2026-02-08T06:00:00Z'), end: new Date('2026-02-09T04:00:00Z') }
const DAY = PlainDate.from('2026-02-08')
const CWD = '/home/jane/code/atlas'

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj)
}

function userLine(ts: string, content: unknown, extra: Record<string, unknown> = {}): string {
  return line({ type: 'user', timestamp: ts, cwd: CWD, sessionId: 'abc123', message: { content }, ...extra })
}

function assistantLine(ts: string, content: unknown[]): string {
  return line({ type: 'assistant', timestamp: ts, cwd: CWD, sessionId: 'abc123', message: { content } })
}

async function writeFixtureProject(root: string, dirName: string, fileName: string, lines: string[]): Promise<void> {
  const dir = path.join(root, dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, fileName), lines.join('\n'))
}

function mkSession(overrides: Partial<ClaudeSession>): ClaudeSession {
  return {
    sessionId: 'abc123',
    cwd: CWD,
    repo: 'atlas',
    start: new Date('2026-02-08T09:02:00Z'),
    end: new Date('2026-02-08T11:28:00Z'),
    prompts: 18,
    filesTouched: 0,
    gist: '',
    promptLog: [],
    finalAssistant: '',
    files: [],
    commandLog: [],
    commits: [],
    ...overrides,
  }
}

test('scanClaudeSessions extracts the full session record', async () => {
  const root = await makeTempDir()

  await writeFixtureProject(root, 'home-jane-code-atlas', 'abc123.jsonl', [
    line({ type: 'meta', sessionId: 'abc123' }), // no timestamp — ignored
    userLine('2026-02-08T09:02:00Z', 'design the recap feature'),
    userLine('2026-02-08T09:30:00Z', [{ type: 'tool_result', content: 'ok' }]), // tool result, not typed
    userLine('2026-02-08T10:00:00Z', '<command-name>/effort</command-name>'), // harness turn
    userLine('2026-02-08T10:05:00Z', 'now build it'),
    assistantLine('2026-02-08T10:06:00Z', [
      { type: 'text', text: 'Building now.' },
      { type: 'tool_use', name: 'Edit', input: { file_path: `${CWD}/src/a.ts` } },
    ]),
    assistantLine('2026-02-08T10:30:00Z', [
      {
        type: 'tool_use',
        name: 'Bash',
        input: { command: 'git commit -m "feat(widget): add the widget"', description: 'Commit the widget' },
      },
    ]),
    assistantLine('2026-02-08T11:28:00Z', [
      { type: 'text', text: 'Done — widget shipped, tests green.' },
      { type: 'tool_use', name: 'Write', input: { file_path: `${CWD}/src/b.ts` } },
    ]),
    userLine('2026-02-08T12:00:00Z', 'sidechain prompt', { isSidechain: true }), // subagent
    userLine('2026-02-07T08:00:00Z', 'yesterday, outside the window'),
  ])

  const sessions = await scanClaudeSessions(root, WINDOW)

  assert({
    given: 'one transcript with in-window events',
    should: 'yield one session',
    expected: 1,
    actual: sessions.length,
  })

  const session = sessions[0]

  assert({
    given: 'typed prompts mixed with tool results, harness turns and sidechains',
    should: 'log only the typed ones',
    expected: ['design the recap feature', 'now build it'],
    actual: session.promptLog.map((p) => p.text),
  })

  assert({
    given: 'the session cwd',
    should: 'keep it and use its basename as the repo',
    expected: `${CWD} atlas`,
    actual: `${session.cwd} ${session.repo}`,
  })

  assert({
    given: 'a git commit Bash call',
    should: 'extract the commit subject',
    expected: ['feat(widget): add the widget'],
    actual: session.commits,
  })

  assert({
    given: 'a Bash call with a description',
    should: 'record the action trail',
    expected: ['Commit the widget'],
    actual: session.commandLog,
  })

  assert({
    given: 'two assistant text messages',
    should: 'keep the last as the final message',
    expected: 'Done — widget shipped, tests green.',
    actual: session.finalAssistant,
  })

  assert({
    given: 'two edit tool calls on distinct files',
    should: 'count both',
    expected: 2,
    actual: session.filesTouched,
  })

  assert({
    given: 'in-window events from 09:02 to 11:28',
    should: 'span first to last',
    expected: '2026-02-08T09:02:00.000Z -> 2026-02-08T11:28:00.000Z',
    actual: `${session.start.toISOString()} -> ${session.end.toISOString()}`,
  })
})

test('scanClaudeSessions excludes workflow dirs, agent transcripts and noise-only files', async () => {
  const root = await makeTempDir()

  await writeFixtureProject(root, 'wf_run-1', 'one.jsonl', [userLine('2026-02-08T09:00:00Z', 'injected prompt')])
  await writeFixtureProject(root, 'home-jane-code-atlas', 'agent-xyz.jsonl', [
    userLine('2026-02-08T09:00:00Z', 'agent prompt'),
  ])
  await writeFixtureProject(root, 'home-jane-code-beta', 'noise.jsonl', [
    userLine('2026-02-08T09:00:00Z', [{ type: 'tool_result', content: 'ok' }]),
  ])

  const sessions = await scanClaudeSessions(root, WINDOW)

  assert({
    given: 'a workflow dir, an agent transcript and a prompt-less transcript',
    should: 'yield no sessions',
    expected: 0,
    actual: sessions.length,
  })
})

test('topDirs ranks work areas relative to the session cwd', () => {
  const session = mkSession({
    files: [`${CWD}/commands/all/recap/lib/a.ts`, `${CWD}/commands/all/recap/lib/b.ts`, `${CWD}/models/Recap/mod.ts`],
  })

  assert({
    given: 'files clustered in two directories',
    should: 'rank the busier one first',
    expected: ['commands/all/recap/lib', 'models/Recap'],
    actual: topDirs(session),
  })
})

test('renderClaudeCodeRecap renders digest blocks and mechanical fallbacks', () => {
  const sessions = [
    mkSession({ prompts: 18 }),
    mkSession({
      start: new Date('2026-02-08T22:40:00Z'),
      end: new Date('2026-02-09T01:10:00Z'),
      prompts: 5,
      gist: 'late-night fixes',
      files: [`${CWD}/src/x.ts`],
      commits: ['fix(widget): patch the widget'],
    }),
  ]
  const digests: Array<SessionDigest | null> = [
    {
      title: 'recap feature: design + build',
      about: 'Named and built the recap concept end-to-end.',
      decided: ['vocabulary: app → activity → recap'],
      built: ['RecapDocument model'],
      open: ['commit split awaiting review'],
      learned: [],
    },
    null,
  ]

  const rendered = renderClaudeCodeRecap(sessions, DAY, 'UTC', digests)

  assert({
    given: 'a digested session',
    should: 'use its title in the heading',
    expected: true,
    actual: rendered.body.includes('## 09:02 - 11:28 · recap feature: design + build (18 prompts)'),
  })

  assert({
    given: 'a digested session',
    should: 'render about and Decided/Built/Open bullets',
    expected: true,
    actual:
      rendered.body.includes('Named and built the recap concept end-to-end.') &&
      rendered.body.includes('- Decided: vocabulary: app → activity → recap') &&
      rendered.body.includes('- Built: RecapDocument model') &&
      rendered.body.includes('- Open: commit split awaiting review'),
  })

  assert({
    given: 'a session whose digest failed',
    should: 'fall back to the mechanical trail with extended-hours span',
    expected: true,
    actual:
      rendered.body.includes('## 22:40 - 25:10 · src (5 prompts)') &&
      rendered.body.includes('- Worked in: src') &&
      rendered.body.includes('- Committed: fix(widget): patch the widget') &&
      rendered.body.includes('- First prompt: late-night fixes'),
  })

  assert({
    given: 'two sessions in one repo',
    should: 'render the totals line with the repo name',
    expected: true,
    actual: rendered.body.includes('2 sessions · 23 prompts · atlas'),
  })
})
