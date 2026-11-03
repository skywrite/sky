import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import { exists } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { loadBeeperSyncState, markKnown, syncBeeper, type BeeperSyncOptions } from './capture.ts'
import type { BeeperChat, BeeperMessage, BeeperPage } from './client.ts'
import { createFirstContactPitchScreen } from './firstContactPitch.ts'

const incoming = (id: string, text: string, extra: Partial<BeeperMessage> = {}): BeeperMessage => ({
  id,
  text,
  chatID: 'chat',
  accountID: 'telegram',
  senderID: 'alex',
  isSender: false,
  timestamp: '2026-03-11T09:00:00Z',
  sortKey: id,
  type: 'TEXT',
  ...extra,
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-pitch-capture-'))
  const chat: BeeperChat = {
    id: 'chat',
    accountID: 'telegram',
    network: 'Telegram',
    title: 'Alex Example',
    type: 'single',
    participants: { items: [{ id: 'alex', fullName: 'Alex Example', phoneNumber: '+15550101234' }] },
    lastActivity: '2026-03-11T09:00:00Z',
  }
  const control = {
    pages: [
      { items: [incoming('1', 'We have not met. Can I pitch my advertising package?')], hasMore: false },
    ] as BeeperPage<BeeperMessage>[],
    reads: [] as (string | undefined)[],
    requests: 0,
    downloads: 0,
    scores: [0.99, 0.99, 0.01],
    fail: false,
  }
  const client = createTypeSafeClient({
    secrets: new TestSecretsProvider({ 'typesafe/main': createSecret('synthetic-key') }),
    fetch: (async (_url, _init) => {
      control.requests++
      if (control.fail) throw new Error('Synthetic provider outage')
      return Response.json({
        model: 'jev-test',
        answers: {
          first_contact: { type: 'noul', noul: control.scores[0] },
          unsolicited_pitch: { type: 'noul', noul: control.scores[1] },
          uncertain_context: { type: 'noul', noul: control.scores[2] },
        },
        usage: { input_tokens: 100, output_tokens: 0 },
      })
    }) as typeof fetch,
  })
  const options: BeeperSyncOptions = {
    timeDir: path.join(root, 'time'),
    attachmentsDir: path.join(root, 'attachments'),
    stateFile: path.join(root, 'state.json'),
    timezone: 'UTC',
    dayTimezone: async () => 'UTC',
    now: '2026-03-11T10:00:00Z',
    ownerName: 'Jane Doe',
    screenFirstContactPitch: createFirstContactPitchScreen({ client, sink: () => {} }),
    client: {
      accounts: async () => [{ accountID: 'telegram', network: 'Telegram', user: { id: 'me', fullName: 'Jane Doe' } }],
      searchChats: async (params) => ({
        items: (chat.lastActivity ?? '') > (params?.lastActivityAfter ?? '') ? [chat] : [],
        hasMore: false,
      }),
      messages: async (_id, params) => {
        control.reads.push(params?.cursor)
        return control.pages[Number(params?.cursor ?? 0)] ?? { items: [], hasMore: false }
      },
      downloadAsset: async () => {
        control.downloads++
        throw new Error('Synthetic download should be unnecessary')
      },
    },
  }
  await writeFile(
    options.stateFile,
    JSON.stringify({ version: 1, accounts: { telegram: { network: 'Telegram', save: true, holdUnknown: true } } }),
  )
  return { root, chat, control, options, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('a named first-time pitch is held before notebook writes, cached, and recoverable with Save', async () => {
  const f = await fixture()
  try {
    f.control.pages[0].items[0].attachments = [{ type: 'file', srcURL: 'https://example.com/proposal.pdf' }]
    const first = await syncBeeper(f.options)
    const state = await loadBeeperSyncState(f.options.stateFile)
    const heldReason = state.held.chat.reason
    const noNotebook = !(await exists(f.options.timeDir)) && !(await exists(f.options.attachmentsDir))
    const second = await syncBeeper(f.options)
    const requestsBeforeSave = f.control.requests
    const downloadsBeforeSave = f.control.downloads
    state.lastSync = '2026-03-12T10:00:00Z'
    markKnown(state, 'chat')
    await writeFile(f.options.stateFile, JSON.stringify(state))
    const saved = await syncBeeper({ ...f.options, now: '2026-03-12T10:00:00Z' })
    const afterSave = await loadBeeperSyncState(f.options.stateFile)
    assert({
      given: 'a named Telegram stranger pitching a service, two syncs, then Save on the held chat',
      should: 'hold without files or downloads, reuse the Jev judgment, and save the original message when allowed',
      actual: [
        first.messages,
        first.held,
        heldReason,
        state.chats.chat?.newest,
        noNotebook,
        second.messages,
        requestsBeforeSave,
        downloadsBeforeSave,
        saved.messages,
        Object.keys(afterSave.held),
        afterSave.chats.chat.known,
      ],
      expected: [
        0,
        [{ chat: 'Alex Example', network: 'Telegram' }],
        'first-time pitch',
        undefined,
        true,
        0,
        1,
        0,
        1,
        [],
        true,
      ],
    })
  } finally {
    await f.cleanup()
  }
})

test('an owner reply older than the capture window prevents first-contact filtering', async () => {
  const f = await fixture()
  try {
    f.control.pages = [
      { items: [incoming('3', 'Here is our new proposal.')], hasMore: true, oldestCursor: '1' },
      {
        items: [incoming('2', 'How did the launch go?', { timestamp: '2025-10-02T09:00:00Z' })],
        hasMore: true,
        oldestCursor: '2',
      },
      {
        items: [
          incoming('1', 'Thanks for helping with Atlas.', {
            timestamp: '2025-10-01T09:00:00Z',
            isSender: true,
            senderID: 'me',
          }),
        ],
        hasMore: false,
      },
    ]
    const result = await syncBeeper(f.options)
    const state = await loadBeeperSyncState(f.options.stateFile)
    assert({
      given: 'a recent proposal with an owner reply several months earlier, beyond the import window',
      should: 'walk older pages, recognize the conversation, and import only recent messages without asking Jev',
      actual: [
        result.messages,
        result.held,
        f.control.requests,
        f.control.reads,
        state.chats.chat.replied,
        Object.keys(state.chats.chat.files),
      ],
      expected: [1, [], 0, [undefined, '1', '2'], true, ['2026-03-11']],
    })
  } finally {
    await f.cleanup()
  }
})

test('unreached history and unavailable Jev leave named conversations visible', async () => {
  for (const kind of [
    'missing page',
    'message limit',
    'missing cursor',
    'repeated cursor',
    'outage',
    'uncertain',
  ] as const) {
    const f = await fixture()
    try {
      if (kind === 'missing page') f.control.pages[0] = { ...f.control.pages[0], hasMore: true, oldestCursor: '1' }
      if (kind === 'message limit') {
        f.control.pages[0] = { ...f.control.pages[0], hasMore: true, oldestCursor: '1' }
        f.options.messageLimit = 1
      }
      if (kind === 'missing cursor') f.control.pages[0].hasMore = true
      if (kind === 'repeated cursor') {
        f.control.pages[0] = { ...f.control.pages[0], hasMore: true, oldestCursor: '0' }
      }
      if (kind === 'outage') f.control.fail = true
      if (kind === 'uncertain') f.control.scores = [0.7, 0.99, 0.3]
      const result = await syncBeeper(f.options)
      assert({
        given: kind,
        should: 'save messages and never label the sender a first-time pitch',
        actual: [result.messages, result.held, f.control.requests],
        expected: [1, [], kind === 'outage' || kind === 'uncertain' ? 1 : 0],
      })
    } finally {
      await f.cleanup()
    }
  }
})

test('a greeting can be saved before a later pitch is detected, and replying releases the held messages', async () => {
  const f = await fixture()
  try {
    f.control.pages[0].items = [incoming('1', 'Hello Jane!')]
    f.control.scores = [0.99, 0.01, 0.01]
    const greeting = await syncBeeper(f.options)
    f.control.pages[0].items.push(
      incoming('2', 'Can I sell you our advertising package?', { timestamp: '2026-03-11T09:05:00Z' }),
    )
    f.control.scores = [0.99, 0.99, 0.01]
    const pitch = await syncBeeper(f.options)
    const held = await loadBeeperSyncState(f.options.stateFile)
    f.control.pages[0].items.push(
      incoming('3', 'Please share the details.', { timestamp: '2026-03-11T09:10:00Z', isSender: true, senderID: 'me' }),
    )
    const reply = await syncBeeper(f.options)
    const after = await loadBeeperSyncState(f.options.stateFile)
    assert({
      given: 'an initial greeting, a later pitch, then a reply by the owner',
      should: 'reassess changed evidence and release the held part of the conversation once answered',
      actual: [
        greeting.messages,
        pitch.messages,
        held.held.chat.reason,
        f.control.requests,
        reply.messages,
        after.held,
        after.chats.chat.replied,
      ],
      expected: [1, 0, 'first-time pitch', 2, 2, {}, true],
    })
  } finally {
    await f.cleanup()
  }
})

test('known contacts, groups, disabled screening and disabled capture bypass the pitch screen', async () => {
  for (const kind of ['contact', 'group', 'screen off', 'capture off'] as const) {
    const f = await fixture()
    try {
      if (kind === 'contact') f.options.names = { resolve: () => ({ name: 'Alex Example', known: true }) }
      if (kind === 'group') f.chat.type = 'group'
      const state = await loadBeeperSyncState(f.options.stateFile)
      state.accounts.telegram.groups = true
      if (kind === 'screen off') state.accounts.telegram.holdPitches = false
      if (kind === 'capture off') state.accounts.telegram.save = false
      await writeFile(f.options.stateFile, JSON.stringify(state))
      const result = await syncBeeper(f.options)
      assert({
        given: kind,
        should: 'respect relationships and network choices',
        actual: [result.messages, f.control.requests],
        expected: [kind === 'capture off' ? 0 : 1, 0],
      })
    } finally {
      await f.cleanup()
    }
  }
})

test('a pitch dry run leaves no cache, held entry or notebook files', async () => {
  const f = await fixture()
  try {
    const before = await loadBeeperSyncState(f.options.stateFile)
    const result = await syncBeeper({ ...f.options, dryRun: true })
    const after = await loadBeeperSyncState(f.options.stateFile)
    assert({
      given: 'a dry-run screening of a first-time pitch',
      should: 'report the hold without persisting it',
      actual: [result.messages, result.held.length, after, await exists(f.options.timeDir)],
      expected: [0, 1, before, false],
    })
  } finally {
    await f.cleanup()
  }
})
