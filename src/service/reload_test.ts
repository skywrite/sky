import { assert, test } from '#test'
import { hold } from './activity.ts'
import { createReloadGate, isServerSource, RELOAD_EXIT_CODE } from './reload.ts'

function harness(over: { remindMs?: number } = {}) {
  const codes: number[] = []
  const events: string[] = []
  const gate = createReloadGate({
    root: '/nowhere',
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
      'service/handler/theme/client/chat.tsx',
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
  gate.onChange('service/handler/theme/client/chat.tsx')
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
