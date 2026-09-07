import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { Instant, PlainDate } from '#universal/dates/nbdt/mod.ts'
import scanCodexSessions from './codex.ts'
import { renderCodingRecap } from './codingSession.ts'

const CWD = '/home/jane/code/atlas'
const WINDOW = { start: Instant.from('2026-02-08T06:00:00Z'), end: Instant.from('2026-02-09T04:00:00Z') }

function row(type: string, timestamp: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ type, timestamp, payload })
}

function meta(id = 'session-one', extra: Record<string, unknown> = {}): string {
  return row('session_meta', '2026-02-07T08:00:00Z', { id, cwd: CWD, source: 'cli', ...extra })
}

function user(timestamp: string, message: string): string {
  return row('event_msg', timestamp, { type: 'user_message', message })
}

function message(timestamp: string, role: string, value: string, extra: Record<string, unknown> = {}): string {
  return row('response_item', timestamp, {
    type: 'message',
    role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: value }],
    ...extra,
  })
}

function completed(timestamp: string, item: Record<string, unknown>): string {
  return row('event_msg', timestamp, { type: 'item_completed', item })
}

async function fixture(root: string, relative: string, lines: string[]): Promise<void> {
  const file = path.join(root, relative)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, lines.join('\n'))
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await makeTempDir()
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('Codex reads completed actions from code mode without counting mirrored messages twice', () =>
  withRoot(async (root) => {
    await fixture(root, 'sessions/2026/02/07/rollout-one.jsonl', [
      meta(),
      message('2026-02-08T08:00:00Z', 'user', '# AGENTS.md instructions\nInjected setup'),
      row('turn_context', '2026-02-08T08:00:00Z', { cwd: `${CWD}/src` }),
      message('2026-02-08T09:00:00Z', 'user', 'build the widget'),
      user('2026-02-08T09:00:00.010Z', 'build the widget'),
      completed('2026-02-08T09:00:00.020Z', {
        type: 'UserMessage',
        content: [{ type: 'text', text: 'build the widget' }],
      }),
      completed('2026-02-08T09:01:00Z', { type: 'UserMessage', content: [{ type: 'text', text: 'build the widget' }] }),
      completed('2026-02-08T09:02:00Z', {
        type: 'CommandExecution',
        command: ['/bin/zsh', '-lc', 'bun test'],
        status: 'completed',
        exit_code: 0,
      }),
      completed('2026-02-08T09:03:00Z', {
        type: 'FileChange',
        status: 'completed',
        changes: { 'old.ts': { type: 'update', move_path: 'widget.ts' } },
      }),
      completed('2026-02-08T09:04:00Z', {
        type: 'FileChange',
        status: 'failed',
        changes: { 'failed.ts': { type: 'add' } },
      }),
      completed('2026-02-08T09:05:00Z', {
        type: 'CommandExecution',
        command: ['/bin/zsh', '-lc', 'git commit -m "feat(widget): add widget"'],
        status: 'completed',
        exit_code: 0,
      }),
      completed('2026-02-08T09:06:00Z', {
        type: 'CommandExecution',
        command: ['git', 'commit', '-m', 'failed'],
        status: 'failed',
        exit_code: 1,
      }),
      completed('2026-02-08T09:10:00Z', {
        type: 'AgentMessage',
        content: [{ type: 'Text', text: 'Widget built; tests pass.' }],
        phase: 'final_answer',
      }),
      message('2026-02-08T09:10:00Z', 'assistant', 'Widget built; tests pass.', { phase: 'final_answer' }),
      message('2026-02-08T09:11:00Z', 'assistant', 'Checking one more thing.', { phase: 'commentary' }),
      row('event_msg', '2026-02-08T12:00:00Z', { type: 'token_count' }),
    ])
    const sessions = await scanCodexSessions(root, WINDOW)
    const session = sessions[0]
    assert({
      given: 'three representations of a prompt followed by the same prompt again',
      should: 'count two typed prompts',
      actual: session.prompts,
      expected: 2,
    })
    assert({
      given: 'the session launch dir and a later working dir',
      should: 'keep the launch repo and resolve edited files in the current dir',
      actual: [session.repo, ...session.files],
      expected: ['atlas', `${CWD}/src/old.ts`, `${CWD}/src/widget.ts`],
    })
    assert({
      given: 'completed and failed commits',
      should: 'claim only the completed commit',
      actual: session.commits,
      expected: ['feat(widget): add widget'],
    })
    assert({
      given: 'commands inside code mode',
      should: 'include their actual shell scripts',
      actual: session.commandLog[0],
      expected: 'bun test',
    })
    assert({
      given: 'a final answer followed by commentary',
      should: 'retain the final answer for the digest',
      actual: session.finalAssistant,
      expected: 'Widget built; tests pass.',
    })
    assert({
      given: 'setup and bookkeeping surrounding the work',
      should: 'span only work activity',
      actual: [session.start.toString(), session.end.toString()],
      expected: ['2026-02-08T09:00:00.01Z', '2026-02-08T09:11:00Z'],
    })
  }))

test('Codex reads legacy shell and patch results, including moves and failed calls', () =>
  withRoot(async (root) => {
    const patch =
      '*** Begin Patch\n*** Update File: old.ts\n*** Move to: new.ts\n@@\n-a\n+b\n*** Add File: added.ts\n+x\n*** Delete File: removed.ts\n*** End Patch'
    await fixture(root, 'archived_sessions/rollout-old.jsonl', [
      meta(),
      user('2026-02-08T09:00:00Z', 'finish the widget'),
      row('response_item', '2026-02-08T09:01:00Z', {
        type: 'function_call',
        name: 'shell',
        call_id: 'one',
        arguments: JSON.stringify({ command: ['bash', '-lc', 'git commit -m "fix(widget): repair widget"'] }),
      }),
      row('response_item', '2026-02-08T09:02:00Z', {
        type: 'function_call_output',
        call_id: 'one',
        output: JSON.stringify({ metadata: { exit_code: 0 } }),
      }),
      row('response_item', '2026-02-08T09:03:00Z', {
        type: 'custom_tool_call',
        name: 'functions.apply_patch',
        call_id: 'two',
        input: patch,
      }),
      row('response_item', '2026-02-08T09:04:00Z', {
        type: 'custom_tool_call_output',
        call_id: 'two',
        output: 'Success. Updated the following files:',
      }),
      row('response_item', '2026-02-08T09:05:00Z', {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'three',
        arguments: JSON.stringify({ cmd: 'bun test', workdir: CWD }),
      }),
      row('response_item', '2026-02-08T09:06:00Z', {
        type: 'function_call_output',
        call_id: 'three',
        output: 'Process exited with code 1',
      }),
      row('response_item', '2026-02-08T09:07:00Z', {
        type: 'custom_tool_call',
        name: 'apply_patch',
        call_id: 'four',
        input: '*** Add File: rejected.ts',
      }),
      row('response_item', '2026-02-08T09:08:00Z', {
        type: 'custom_tool_call_output',
        call_id: 'four',
        output: 'patch rejected',
      }),
      row('response_item', '2026-02-08T09:09:00Z', {
        type: 'function_call',
        name: 'shell_command',
        call_id: 'five',
        arguments: '{bad',
      }),
      message('2026-02-08T09:10:00Z', 'assistant', 'Changes made; one test still fails.'),
    ])
    const [session] = await scanCodexSessions(root, WINDOW)
    assert({
      given: 'a successful legacy patch with a move',
      should: 'record both paths, additions and deletions',
      actual: session.files,
      expected: ['old.ts', 'new.ts', 'added.ts', 'removed.ts'].map((file) => `${CWD}/${file}`),
    })
    assert({
      given: 'a legacy shell commit result',
      should: 'extract its subject',
      actual: session.commits,
      expected: ['fix(widget): repair widget'],
    })
    assert({
      given: 'a failed test command',
      should: 'keep it in the action trail',
      actual: session.commandLog.includes('bun test'),
      expected: true,
    })
  }))

test('Codex scans resumed and archived sessions by event time, deduplicates copies, and excludes agents', () =>
  withRoot(async (root) => {
    const lines = [meta(), user('2026-02-08T10:00:00Z', 'resume old work')]
    await fixture(root, 'sessions/2025/01/01/rollout-resumed.jsonl', lines)
    await fixture(root, 'archived_sessions/rollout-copy.jsonl', [
      ...lines,
      message('2026-02-08T11:00:00Z', 'assistant', 'Resumed work finished.'),
    ])
    await fixture(root, 'archived_sessions/rollout-second.jsonl', [
      meta('session-two'),
      user('2026-02-08T08:00:00Z', 'earlier work'),
    ])
    await fixture(root, 'sessions/agent.jsonl', [
      meta('agent', { source: { subagent: { thread_spawn: { parent_thread_id: 'root' } } } }),
      user('2026-02-08T09:00:00Z', 'delegated work'),
    ])
    await fixture(root, 'sessions/exec.jsonl', [
      meta('automation', { source: 'exec' }),
      user('2026-02-08T09:00:00Z', 'injected task'),
    ])
    await fixture(root, 'sessions/old.jsonl', [meta('old'), user('2026-02-07T09:00:00Z', 'outside window')])
    await fixture(root, 'sessions/noise.jsonl', [
      meta('noise'),
      row('event_msg', '2026-02-08T09:00:00Z', { type: 'token_count' }),
    ])
    const sessions = await scanCodexSessions(root, WINDOW)
    assert({
      given: 'old paths, archives, duplicates and delegated work',
      should: 'keep two distinct user sessions sorted by activity',
      actual: sessions.map((session) => session.sessionId),
      expected: ['session-two', 'session-one'],
    })
    assert({
      given: 'an archive copy with more recent activity',
      should: 'keep the more complete record',
      actual: sessions[1].finalAssistant,
      expected: 'Resumed work finished.',
    })
  }))

test('Codex preserves exact day boundaries and tolerates malformed JSONL', () =>
  withRoot(async (root) => {
    await fixture(root, 'sessions/rollout.jsonl', [
      meta(),
      'null',
      '[]',
      '{bad json',
      user('not a timestamp', 'invalid time'),
      user('2026-02-08T05:59:59.999Z', 'before start'),
      user('2026-02-08T00:00:00-06:00', 'inclusive start'),
      user('2026-02-09T03:59:59.999Z', 'before end'),
      completed('2026-02-09T04:00:00.010Z', {
        type: 'UserMessage',
        content: [{ type: 'text', text: 'before end' }],
      }),
      user('2026-02-09T04:00:00Z', 'exclusive end'),
      '{"type":"event_msg"',
    ])
    const [session] = await scanCodexSessions(root, WINDOW)
    assert({
      given: 'offset and fractional timestamps at both boundaries',
      should: 'include only start <= event < end',
      actual: session.promptLog.map((prompt) => prompt.text),
      expected: ['inclusive start', 'before end'],
    })
    assert({
      given: 'an event one millisecond before the boundary',
      should: 'preserve its exact instant',
      actual: session.end.toString(),
      expected: '2026-02-09T03:59:59.999Z',
    })
  }))

test('Codex falls back to response messages while filtering injected instructions', () =>
  withRoot(async (root) => {
    await fixture(root, 'sessions/rollout.jsonl', [
      meta(),
      message('2026-02-08T08:00:00Z', 'user', '# AGENTS.md instructions\nProject setup'),
      message('2026-02-08T08:01:00Z', 'user', '<environment_context>setup</environment_context>'),
      message('2026-02-08T08:02:00Z', 'user', 'injected instructions', {
        internal_chat_message_metadata_passthrough: { content_item_kinds: ['agents_md.instructions'] },
      }),
      message('2026-02-08T09:00:00Z', 'user', 'explain the widget'),
      message('2026-02-08T09:01:00Z', 'assistant', 'The widget has two parts.', { phase: 'final_answer' }),
    ])
    const [session] = await scanCodexSessions(root, WINDOW)
    assert({
      given: 'a response-only rollout',
      should: 'retain only the user request',
      actual: session.promptLog.map((prompt) => prompt.text),
      expected: ['explain the widget'],
    })
  }))

test('Codex keeps continuations with no new prompts and renders Codex recap blocks', () =>
  withRoot(async (root) => {
    await fixture(root, 'sessions/rollout.jsonl', [
      meta(),
      user('2026-02-07T23:00:00Z', 'finish the widget'),
      completed('2026-02-08T22:00:00Z', {
        type: 'FileChange',
        status: 'completed',
        changes: { 'src/widget.ts': { type: 'add' } },
      }),
      message('2026-02-09T01:15:00Z', 'assistant', 'Widget completed.', { phase: 'final_answer' }),
    ])
    const sessions = await scanCodexSessions(root, WINDOW)
    const rendered = renderCodingRecap(sessions, 'Codex', PlainDate.from('2026-02-08'), 'UTC')
    assert({
      given: 'work continuing after the original prompt',
      should: 'retain activity with zero new prompts',
      actual: sessions[0].prompts,
      expected: 0,
    })
    assert({
      given: 'Codex work spanning midnight',
      should: 'use Codex identity and extended hours',
      actual:
        rendered.body.includes('# Codex — Feb 8') &&
        rendered.body.includes('22:00 - 25:15') &&
        rendered.body.includes('- Worked in: src'),
      expected: true,
    })
  }))

test('Codex does not replay inherited work in a fork', () =>
  withRoot(async (root) => {
    await fixture(root, 'sessions/fork.jsonl', [
      meta('fork', { forked_from_id: 'original', timestamp: '2026-02-08T12:00:00Z' }),
      user('2026-02-08T09:00:00Z', 'inherited prompt'),
      user('2026-02-08T12:01:00Z', 'new direction'),
    ])
    const [session] = await scanCodexSessions(root, WINDOW)
    assert({
      given: 'a fork containing earlier history',
      should: 'count only work after the fork',
      actual: session.promptLog.map((prompt) => prompt.text),
      expected: ['new direction'],
    })
  }))

test('Codex treats a missing history directory as no activity', () =>
  withRoot(async (root) => {
    assert({
      given: 'no Codex logs',
      should: 'return an empty list',
      actual: await scanCodexSessions(root, WINDOW),
      expected: [],
    })
  }))

test('Codex bounds digest material without truncating the prompt count', () =>
  withRoot(async (root) => {
    await fixture(root, 'sessions/rollout.jsonl', [
      meta(),
      ...Array.from({ length: 410 }, (_, index) =>
        user('2026-02-08T09:00:00Z', `Request ${index} ${'x'.repeat(2_000)}`),
      ),
      completed('2026-02-08T10:00:00Z', {
        type: 'CommandExecution',
        command: ['git', 'commit', '-m', 'feat(widget): finish widget'],
        status: 'completed',
        exit_code: 0,
      }),
    ])
    const [session] = await scanCodexSessions(root, WINDOW)
    assert({
      given: 'more prompts than the material cap',
      should: 'count every prompt while capping retained text',
      actual: [session.prompts, session.promptLog.length, session.promptLog[0].text.length],
      expected: [410, 400, 1_500],
    })
    assert({
      given: 'a command expressed as argv instead of a shell script',
      should: 'retain its commit subject',
      actual: session.commits,
      expected: ['feat(widget): finish widget'],
    })
  }))
