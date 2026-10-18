import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { hold } from './activity.ts'
import { createReloadGate, isServerSource, RELOAD_EXIT_CODE } from './reload.ts'

/** A root of '/nowhere' has nothing to compare with, so every reported change counts */
function harness(over: { remindMs?: number; root?: string } = {}) {
  const codes: number[] = []
  const events: string[] = []
  const gate = createReloadGate({
    root: over.root ?? '/nowhere',
    watch: false,
    exit: (code) => codes.push(code),
    log: {
      info: (_m, data) => events.push(String(data?.event ?? 'info')),
      warn: (_m, data) => events.push(String(data?.event ?? 'warn')),
    },
    debounceMs: 5,
    graceMs: 5,
    remindMs: over.remindMs ?? 1000,
  })
  return { gate, codes, events }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A source tree in a temp folder, written before the gate hashes it */
function sourceTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sky-reload-'))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
  }
  return root
}

test({ name: 'reload - the server source calls for a restart; pages, tests, docs, and fixtures do not' }, async () => {
  assert({
    given: 'paths under src',
    should: 'say which changes need the process to start again',
    actual: [
      'service/handler/chat/mod.ts',
      'commands/all/day/mod.ts',
      '.env',
      'package.json',
      '_shared-ts/models/DomainCollection/query/schema.graphql',
      'web/client/chat/chat.tsx',
      'service/handler/chat/chatRoute_test.ts',
      'service/handler/chat/docs/README.md',
      '_shared-ts/models/Chat/ChatContext/fixtures/notebook/day.md',
      'node_modules/hono/dist/index.js',
      'commands/lib/voice/prompts/voice.prompt.md',
    ].map(isServerSource),
    expected: [true, true, true, true, true, false, false, false, false, false, false],
  })
})

test({ name: 'reload - a change with nothing held restarts once, after the grace' }, async () => {
  const { gate, codes, events } = harness()
  gate.onChange('service/run.ts')
  gate.onChange('web/client/chat/chat.tsx')
  gate.onChange('service/server.ts')
  const before = gate.status()
  await settle(30)
  gate.onChange('service/store.ts')
  await settle(30)
  assert({
    given: 'three saves in one burst, one of them a page file, then another after leaving',
    should: 'exit with the reload code once, having marked one restart pending for the two server files',
    actual: { before, codes, events, after: gate.status().pending?.files },
    expected: {
      before: { pending: null, holding: [] },
      codes: [RELOAD_EXIT_CODE],
      events: ['reload-pending', 'reload'],
      after: ['service/run.ts', 'service/server.ts'],
    },
  })
  gate.close()
})

test({ name: 'reload - a change while something is held waits for the release' }, async () => {
  const { gate, codes, events } = harness()
  const release = hold('chat turn')
  gate.onChange('service/run.ts')
  await settle(30)
  const whileHeld = { codes: [...codes], status: gate.status() }
  release()
  await settle(30)
  assert({
    given: 'a save during a chat turn, then the turn ending',
    should: 'stay pending and say what it waits on, then restart once the turn lets go',
    actual: {
      whileHeld: {
        codes: whileHeld.codes,
        holding: whileHeld.status.holding,
        reasons: whileHeld.status.pending?.reasons,
      },
      codes,
      events,
    },
    expected: {
      whileHeld: { codes: [], holding: ['chat turn'], reasons: ['source changed'] },
      codes: [RELOAD_EXIT_CODE],
      events: ['reload-pending', 'reload-deferred', 'reload'],
    },
  })
  gate.close()
})

test({ name: 'reload - the wait follows the current background step until the work ends' }, async () => {
  const { gate, codes } = harness()
  const release = hold('Slack follow check')
  gate.request('source changed')
  await settle(30)
  const first = gate.status().holding
  release.update('email follow sync')
  await settle(30)
  const second = { holding: gate.status().holding, codes: [...codes] }
  release()
  await settle(30)
  gate.close()
  assert({
    given: 'a pending restart while a background check moves from Slack to email',
    should: 'report the current step, keep waiting between steps, and restart only after the work ends',
    actual: { first, second, codes },
    expected: {
      first: ['Slack follow check'],
      second: { holding: ['email follow sync'], codes: [] },
      codes: [RELOAD_EXIT_CODE],
    },
  })
})

test({ name: 'reload - a wait with no end in sight says so now and then, and never forces its way out' }, async () => {
  const { gate, codes, events } = harness({ remindMs: 15 })
  const release = hold('import')
  gate.request('twelve hours up')
  await settle(70)
  const whileHeld = { codes: [...codes], reminders: events.filter((e) => e === 'reload-waiting').length }
  release()
  await settle(30)
  assert({
    given: 'a restart asked for during an import that runs on and on',
    should: 'stay put while it runs, say so every so often, and go once it ends',
    actual: { whileHeld: { codes: whileHeld.codes, reminded: whileHeld.reminders >= 2 }, codes, last: events.at(-1) },
    expected: { whileHeld: { codes: [], reminded: true }, codes: [RELOAD_EXIT_CODE], last: 'reload' },
  })
  gate.close()
})

test({ name: 'reload - an event that leaves the bytes as they were does not restart' }, async () => {
  const root = sourceTree({
    'service/run.ts': 'export const run = 1\n',
    'service/server.ts': 'export const server = 1\n',
    'service/store.ts': 'export const store = 1\n',
  })
  const { gate, codes, events } = harness({ root })
  // What a sync tool stamping its own file IDs looks like to the watcher
  chmodSync(path.join(root, 'service/run.ts'), 0o600)
  utimesSync(path.join(root, 'service/server.ts'), 1_700_000_000, 1_700_000_000)
  writeFileSync(path.join(root, 'service/store.ts'), 'export const store = 1\n')
  for (const file of ['service/run.ts', 'service/server.ts', 'service/store.ts']) gate.onChange(file)
  await settle(30)
  gate.close()
  rmSync(root, { recursive: true, force: true })
  assert({
    given: 'a permissions change, a touch, and a save of the same bytes',
    should: 'not mark a restart',
    actual: { codes, events, pending: gate.status().pending },
    expected: { codes: [], events: [], pending: null },
  })
})

test({ name: 'reload - an edit, a new file, and a removed file restart, and only they are named' }, async () => {
  const root = sourceTree({
    'service/run.ts': 'export const run = 1\n',
    'service/server.ts': 'export const server = 1\n',
    'service/store.ts': 'export const store = 1\n',
  })
  const { gate, codes, events } = harness({ root })
  writeFileSync(path.join(root, 'service/run.ts'), 'export const run = 2\n')
  chmodSync(path.join(root, 'service/server.ts'), 0o600)
  writeFileSync(path.join(root, 'service/added.ts'), 'export const added = 1\n')
  rmSync(path.join(root, 'service/store.ts'))
  for (const file of ['service/run.ts', 'service/server.ts', 'service/added.ts', 'service/store.ts']) {
    gate.onChange(file)
  }
  await settle(30)
  gate.close()
  rmSync(root, { recursive: true, force: true })
  assert({
    given: 'one burst with an edit, a permissions change, a new file, and a deleted file',
    should: 'restart once, naming the edited, added, and deleted files but not the one whose bytes stayed',
    actual: { codes, events, files: gate.status().pending?.files },
    expected: {
      codes: [RELOAD_EXIT_CODE],
      events: ['reload-pending', 'reload'],
      files: ['service/run.ts', 'service/added.ts', 'service/store.ts'],
    },
  })
})

test({ name: 'reload - asked to restart now, it goes at once, held or not' }, async () => {
  const { gate, codes, events } = harness()
  const release = hold('chat turn')
  gate.restartNow('asked from the page')
  gate.restartNow('asked twice')
  release()
  assert({
    given: 'the person asking during a turn, twice',
    should: 'exit once, immediately',
    actual: { codes, events },
    expected: { codes: [RELOAD_EXIT_CODE], events: ['reload'] },
  })
  gate.close()
})
