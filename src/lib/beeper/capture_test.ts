import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import MessageDocument from '#shared/models/Message/document/mod.ts'
import { dayAttachmentsDir, dayDir, dayFile, writeDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { type BeeperSource, loadBeeperSyncState, markKnown, syncBeeper } from './capture.ts'
import type { BeeperChat, BeeperMessage, ChatSearch } from './client.ts'

type World = { chats: BeeperChat[]; messages: Record<string, BeeperMessage[]>; asset: string }

/** Beeper as the sync sees it: chats by last activity, messages by cursor, one downloadable file. */
function beeperWith(world: World): BeeperSource & { calls: string[] } {
  const calls: string[] = []
  const sorted = (chatID: string) =>
    [...(world.messages[chatID] ?? [])].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  return {
    calls,
    accounts: async () => [
      {
        accountID: 'whatsapp',
        network: 'WhatsApp',
        status: 'connected',
        user: { id: 'me', fullName: 'Jane Doe', isSelf: true },
        bridge: { id: 'whatsapp', type: 'whatsapp' },
      },
      {
        accountID: 'slack',
        network: 'Slack',
        status: 'connected',
        user: { id: 'me2' },
        bridge: { id: 'slackgo', type: 'slackgo' },
      },
    ],
    searchChats: async (params: ChatSearch = {}) => {
      calls.push(`search after ${params.lastActivityAfter}`)
      return {
        items: world.chats.filter((chat) => (chat.lastActivity ?? '') > (params.lastActivityAfter ?? '')),
        hasMore: false,
      }
    },
    messages: async (chatID, params: { cursor?: string; direction?: 'before' | 'after' } = {}) => {
      calls.push(`messages ${chatID} ${params.direction ?? 'first'} ${params.cursor ?? ''}`.trim())
      const all = sorted(chatID)
      if (params.cursor && params.direction === 'after') {
        const after = all.filter((message) => message.sortKey > params.cursor!)
        return {
          items: after,
          hasMore: false,
          newestCursor: after.at(-1)?.sortKey ?? params.cursor,
          oldestCursor: after[0]?.sortKey,
        }
      }
      return { items: all, hasMore: false, oldestCursor: all[0]?.sortKey, newestCursor: all.at(-1)?.sortKey }
    },
    downloadAsset: async (url) => {
      calls.push(`download ${url}`)
      return { srcURL: world.asset }
    },
  }
}

function message(
  chatID: string,
  sortKey: string,
  timestamp: string,
  text: string,
  extra: Partial<BeeperMessage> = {},
): BeeperMessage {
  return {
    id: `${chatID}-${sortKey}`,
    chatID,
    accountID: 'whatsapp',
    senderID: extra.isSender ? 'me' : 'u1',
    senderName: extra.isSender ? 'Jane Doe' : 'Maya Okafor',
    timestamp,
    sortKey,
    type: 'TEXT',
    text,
    ...extra,
  }
}

test('beeper capture - chats land as one saved message per chat per day, then grow in place', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-capture-'))
  const timeDir = path.join(root, 'time')
  const attachmentsDir = path.join(root, 'attachments')
  const stateFile = path.join(root, 'state', 'beeper', 'sync.json')
  const asset = path.join(root, 'beeper-cache', 'budget.png')
  await mkdir(path.dirname(asset), { recursive: true })
  await writeFile(asset, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  const world: World = {
    asset: `file://${asset}`,
    chats: [
      {
        id: 'c1',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: 'Maya Okafor',
        type: 'single',
        participants: {
          items: [
            { id: 'u1', fullName: 'Maya Okafor' },
            { id: 'me', fullName: 'Jane Doe', isSelf: true },
          ],
        },
        lastActivity: '2026-03-11T08:05:00Z',
      },
      {
        id: 'c2',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: 'Atlas launch team',
        type: 'group',
        lastActivity: '2026-03-11T07:55:00Z',
      },
      {
        id: 'c3',
        accountID: 'whatsapp',
        network: 'Telegram',
        title: 'Atlas news',
        type: 'group',
        isReadOnly: true,
        lastActivity: '2026-03-11T09:00:00Z',
      },
      {
        id: 'c4',
        accountID: 'slack',
        network: 'Slack',
        title: 'atlas-gtm',
        type: 'group',
        lastActivity: '2026-03-11T09:00:00Z',
      },
    ],
    messages: {
      c1: [
        message('c1', '0001', '2026-03-10T09:12:00Z', '<p>Can you approve the <b>pilot budget</b> by Friday?</p>'),
        message('c1', '0002', '2026-03-10T09:30:00Z', 'Looking now.', { isSender: true }),
        message('c1', '0003', '2026-03-11T08:05:00Z', 'Also: the photo', {
          attachments: [{ id: 'mxc://atlas/1', type: 'img', fileName: 'budget.png', mimeType: 'image/png' }],
        }),
        message('c1', '0004', '2026-03-11T08:06:00Z', '', { type: 'REACTION' }),
        message('c1', '0005', '2026-03-11T08:07:00Z', 'gone', { isDeleted: true }),
      ],
      c2: [
        message('c2', '0001', '2026-03-11T07:55:00Z', 'Kickoff moved to 3pm', {
          senderName: 'Sam Lee',
          senderID: 'u2',
        }),
      ],
    },
  }
  const day11 = PlainDate.fromString('2026-03-11')
  await writeDay(DayDocument.createPastDay(day11), timeDir)
  const messagesOf = async (day: string) =>
    (await readdir(path.join(timeDir, dayDir(PlainDate.fromString(day)), 'actions', 'messages')).catch(() => [])).sort()
  const options = { timeDir, attachmentsDir, stateFile, timezone: 'UTC', dayTimezone: async () => 'UTC' }
  // WhatsApp is switched on, groups included, the way the settings page would leave it.
  await mkdir(path.dirname(stateFile), { recursive: true })
  await writeFile(
    stateFile,
    JSON.stringify({
      version: 1,
      chats: {},
      accounts: { whatsapp: { network: 'WhatsApp', save: true, groups: true, holdUnknown: false, chosen: true } },
    }),
  )
  try {
    const dry = await syncBeeper({ ...options, client: beeperWith(world), now: '2026-03-11T13:00:00Z', dryRun: true })
    const afterDry = await messagesOf('2026-03-10')
    const first = await syncBeeper({ ...options, client: beeperWith(world), now: '2026-03-11T13:00:00Z' })
    const day10Files = await messagesOf('2026-03-10')
    const day11Files = await messagesOf('2026-03-11')
    const day10 = MessageDocument.fromMarkdown(
      await readTextFile(
        path.join(timeDir, dayDir(PlainDate.fromString('2026-03-10')), 'actions', 'messages', day10Files[0]),
      ),
    )
    const day11Maya = MessageDocument.fromMarkdown(
      await readTextFile(
        path.join(
          timeDir,
          dayDir(day11),
          'actions',
          'messages',
          day11Files.find((f) => f.includes('Maya'))!,
        ),
      ),
    )
    const group = MessageDocument.fromMarkdown(
      await readTextFile(
        path.join(
          timeDir,
          dayDir(day11),
          'actions',
          'messages',
          day11Files.find((f) => f.includes('Atlas'))!,
        ),
      ),
    )
    const dayText = await readTextFile(path.join(timeDir, dayFile(day11)))
    const saved = await readdir(path.join(attachmentsDir, dayAttachmentsDir(day11)))
    const state = await loadBeeperSyncState(stateFile)
    assert({
      given: 'two WhatsApp chats with three days of talk, a read-only channel, and a Slack chat',
      should: 'write nothing on a dry run, then a file per chat per day with the right names, links, and day entry',
      actual: [
        [dry.messages, dry.files.length, afterDry],
        [first.chats, first.messages, first.files.length, first.complete, first.accountsSkipped, first.skipped],
        day10Files.map((f) => f.replace(/_[^_]*\.md$/, '')),
        day11Files.map((f) => f.replace(/_[^_]*\.md$/, '')),
        [
          day10.from,
          day10.to,
          day10.medium,
          day10.summary,
          day10.yaml.chat,
          day10.yaml.account,
          day10.yaml.group,
          day10.previous,
        ],
        day10.markdown,
        [
          day11Maya.previous?.replace(/_[^_/]*$/, ''),
          day11Maya.attachments,
          day11Maya.markdown.includes('📎 2026-03-11_WhatsApp_budget.png'),
        ],
        [group.from, group.to, group.yaml.group, group.markdown.trim()],
        dayText.includes('08:05 > Maya WhatsApp -> [Also: the photo](actions/messages/'),
        dayText.includes('07:55 > Atlas launch team WhatsApp -> [Kickoff moved to 3pm](actions/messages/'),
        saved,
        first.notes,
        [state.lastSync, state.chats.c1?.cursor, state.chats.c1?.seen, Object.keys(state.chats.c1?.files ?? {})],
      ],
      expected: [
        [4, 3, []],
        [
          2,
          4,
          3,
          true,
          ['Slack'],
          [
            { chat: 'Atlas news', reason: 'read-only' },
            { chat: 'atlas-gtm', reason: 'its account is not captured' },
          ],
        ],
        ['09-12_whatsapp_Maya'],
        ['07-55_whatsapp_Atlas-launch-team', '08-05_whatsapp_Maya'],
        [
          'Maya Okafor',
          'Jane Doe',
          'WhatsApp',
          'Can you approve the pilot budget by Friday?',
          'c1',
          'whatsapp',
          undefined,
          undefined,
        ],
        '## 2026-03-10 09:12 - **Maya Okafor**\n\nCan you approve the **pilot budget** by Friday?\n\n## 2026-03-10 09:30 - **Jane Doe**\n\nLooking now.\n',
        ['10/actions/messages/09-12_whatsapp_Maya', [{ file: '2026-03-11_WhatsApp_budget.png' }], true],
        ['Sam Lee', 'Atlas launch team', true, '## 2026-03-11 07:55 - **Sam Lee**\n\nKickoff moved to 3pm'],
        true,
        true,
        ['2026-03-11_WhatsApp_budget.png'],
        ['2026-03-10 has no day file; the WhatsApp capture is saved without a day entry.'],
        ['2026-03-11T13:00:00Z', '0005', ['c1-0001', 'c1-0002', 'c1-0003'], ['2026-03-10', '2026-03-11']],
      ],
    })

    // A reply later that day continues the day's file; a run with nothing new changes nothing.
    world.messages.c1.push(message('c1', '0006', '2026-03-11T13:30:00Z', 'Thanks!'))
    world.chats[0].lastActivity = '2026-03-11T13:30:00Z'
    const client = beeperWith(world)
    const second = await syncBeeper({ ...options, client, now: '2026-03-11T14:00:00Z' })
    const grown = await readTextFile(
      path.join(
        timeDir,
        dayDir(day11),
        'actions',
        'messages',
        day11Files.find((f) => f.includes('Maya'))!,
      ),
    )
    const third = await syncBeeper({ ...options, client: beeperWith(world), now: '2026-03-11T15:00:00Z' })
    const again = await readTextFile(
      path.join(
        timeDir,
        dayDir(day11),
        'actions',
        'messages',
        day11Files.find((f) => f.includes('Maya'))!,
      ),
    )
    assert({
      given: 'one new message in a chat already saved today, then nothing new',
      should:
        're-list recent chats with some overlap, append after the cursor without a new file, and leave the file alone afterwards',
      actual: [
        client.calls,
        [second.chats, second.messages, second.files, (await messagesOf('2026-03-11')).length],
        grown.endsWith('## 2026-03-11 13:30 - **Maya Okafor**\n\nThanks!\n'),
        MessageDocument.fromMarkdown(grown).attachments,
        [third.chats, third.messages, third.files.length, again === grown],
      ],
      expected: [
        ['search after 2026-03-11T07:00:00Z', 'messages c1 after 0005', 'messages c2 after 0001'],
        [2, 1, ['2026-03-11/actions/messages/' + day11Files.find((f) => f.includes('Maya'))!], 2],
        true,
        [{ file: '2026-03-11_WhatsApp_budget.png' }],
        [1, 0, 0, true],
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('beeper capture - each network has a switch: new ones wait, a network already saved stays on, groups need choosing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-rules-'))
  const timeDir = path.join(root, 'time')
  const attachmentsDir = path.join(root, 'attachments')
  const stateFile = path.join(root, 'state', 'beeper', 'sync.json')
  const world: World = {
    asset: '',
    chats: [
      {
        id: 'c1',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: 'Maya Okafor',
        type: 'single',
        participants: { items: [{ id: 'u1', fullName: 'Maya Okafor' }] },
        lastActivity: '2026-03-11T08:05:00Z',
      },
      {
        id: 'c2',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: 'Atlas launch team',
        type: 'group',
        lastActivity: '2026-03-11T07:55:00Z',
      },
      {
        id: 'c5',
        accountID: 'signal',
        network: 'Signal',
        title: 'Priya Natarajan',
        type: 'single',
        lastActivity: '2026-03-11T09:10:00Z',
      },
    ],
    messages: {
      c1: [message('c1', '0001', '2026-03-11T08:05:00Z', 'Lunch?')],
      c2: [message('c2', '0001', '2026-03-11T07:55:00Z', 'Launch is Tuesday')],
      c5: [message('c5', '0001', '2026-03-11T09:10:00Z', 'Sent the deck', { accountID: 'signal' })],
    },
  }
  const client = beeperWith(world)
  const accounts = client.accounts
  client.accounts = async () => [
    ...(await accounts()),
    { accountID: 'signal', network: 'Signal', status: 'connected', user: { id: 'me3' } },
  ]
  // Before rules existed, Sky was saving WhatsApp: the state knows a WhatsApp chat.
  await mkdir(path.dirname(stateFile), { recursive: true })
  await writeFile(
    stateFile,
    JSON.stringify({
      version: 1,
      lastSync: '2026-03-10T12:00:00Z',
      chats: { c0: { title: 'Old chat', network: 'WhatsApp', seen: [], files: {} } },
    }),
  )
  const options = { timeDir, attachmentsDir, stateFile, timezone: 'UTC', dayTimezone: async () => 'UTC' }
  try {
    const upgraded = await syncBeeper({ ...options, client, now: '2026-03-11T13:00:00Z' })
    const afterUpgrade = await loadBeeperSyncState(stateFile)
    const rulesAfterUpgrade = structuredClone(afterUpgrade.accounts)
    afterUpgrade.accounts.whatsapp!.groups = false
    afterUpgrade.accounts.signal = { network: 'Signal', save: true, groups: false, holdUnknown: false, chosen: true }
    await writeFile(stateFile, JSON.stringify(afterUpgrade))
    const chosen = await syncBeeper({ ...options, client, now: '2026-03-11T14:00:00Z' })
    const final = await loadBeeperSyncState(stateFile)
    assert({
      given: 'a state that was saving WhatsApp before rules existed, and a Signal account seen for the first time',
      should:
        'keep WhatsApp on with groups, leave Signal off until chosen, then honour the choices and remember the run',
      actual: [
        rulesAfterUpgrade,
        [upgraded.chats, upgraded.messages, upgraded.accountsOff, upgraded.skipped],
        [chosen.chats, chosen.messages, chosen.accountsOff, chosen.skipped],
        final.lastRun && {
          at: final.lastRun.at,
          chats: final.lastRun.chats,
          messages: final.lastRun.messages,
          skipped: final.lastRun.skipped,
          accountsOff: final.lastRun.accountsOff,
        },
      ],
      expected: [
        {
          whatsapp: { network: 'WhatsApp', save: true, groups: true, holdUnknown: false, chosen: false },
          signal: { network: 'Signal', save: false, groups: false, holdUnknown: true, chosen: false },
        },
        [2, 2, ['Signal'], []],
        [2, 1, [], [{ chat: 'Atlas launch team', reason: 'groups are off for WhatsApp' }]],
        {
          at: '2026-03-11T14:00:00Z',
          chats: 2,
          messages: 1,
          skipped: [{ chat: 'Atlas launch team', reason: 'groups are off for WhatsApp' }],
          accountsOff: [],
        },
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('beeper capture - a text from someone with no name in the contacts is held, not saved, until the person says Save or writes back', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-held-'))
  const timeDir = path.join(root, 'time')
  const attachmentsDir = path.join(root, 'attachments')
  const stateFile = path.join(root, 'state', 'beeper', 'sync.json')
  const world: World = {
    asset: '',
    chats: [
      {
        id: 'c1',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: 'Maya Okafor',
        type: 'single',
        participants: { items: [{ id: 'u1', fullName: 'Maya Okafor', phoneNumber: '+1 555 010 1000' }] },
        lastActivity: '2026-03-11T08:05:00Z',
      },
      {
        id: 'c6',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: '+1 (555) 010-2277',
        type: 'single',
        participants: { items: [{ id: 'u6', fullName: '+1 (555) 010-2277', phoneNumber: '+15550102277' }] },
        lastActivity: '2026-03-11T09:00:00Z',
      },
      {
        id: 'c7',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: 'dana_k',
        type: 'single',
        participants: { items: [{ id: 'u7', username: 'dana_k' }] },
        lastActivity: '2026-03-11T09:30:00Z',
      },
    ],
    messages: {
      c1: [message('c1', '0001', '2026-03-11T08:05:00Z', 'Lunch?')],
      c6: [
        message(
          'c6',
          '0001',
          '2026-03-11T08:50:00Z',
          'Hi JP, this is Dana with the Atlas campaign. Can we count on you?',
          {
            senderID: 'u6',
            senderName: '+1 (555) 010-2277',
          },
        ),
        message('c6', '0002', '2026-03-11T09:00:00Z', 'Reply STOP to end.', {
          senderID: 'u6',
          senderName: '+1 (555) 010-2277',
        }),
      ],
      c7: [
        message('c7', '0001', '2026-03-11T09:20:00Z', 'Hey, new number — still on for Saturday?', {
          senderID: 'u7',
          senderName: 'dana_k',
        }),
        message('c7', '0002', '2026-03-11T09:30:00Z', 'Yes! See you then.', { isSender: true }),
      ],
    },
  }
  await mkdir(path.dirname(stateFile), { recursive: true })
  await writeFile(
    stateFile,
    JSON.stringify({
      version: 1,
      chats: {},
      accounts: { whatsapp: { network: 'WhatsApp', save: true, groups: false, holdUnknown: true, chosen: true } },
    }),
  )
  const options = { timeDir, attachmentsDir, stateFile, timezone: 'UTC', dayTimezone: async () => 'UTC' }
  try {
    const first = await syncBeeper({ ...options, client: beeperWith(world), now: '2026-03-11T13:00:00Z' })
    const afterFirst = await loadBeeperSyncState(stateFile)
    const filesAfterFirst = (
      await readdir(path.join(timeDir, dayDir(PlainDate.fromString('2026-03-11')), 'actions', 'messages'))
    ).sort()
    const heldAfterFirst = structuredClone(afterFirst.held)
    const c6AfterFirst = structuredClone(afterFirst.chats.c6)
    // The person says Save on the held chat; the next check pulls its month in.
    markKnown(afterFirst, 'c6')
    await writeFile(stateFile, JSON.stringify(afterFirst))
    const second = await syncBeeper({ ...options, client: beeperWith(world), now: '2026-03-11T14:00:00Z' })
    const afterSecond = await loadBeeperSyncState(stateFile)
    const filesAfterSecond = (
      await readdir(path.join(timeDir, dayDir(PlainDate.fromString('2026-03-11')), 'actions', 'messages'))
    ).sort()
    assert({
      given: 'a named contact, a bare number that only ever wrote in, and a handle the person answered',
      should:
        'save the contact and the answered handle, hold the bare number with no file and no cursor, then save it once marked known',
      actual: [
        [first.chats, first.messages, first.held],
        heldAfterFirst,
        c6AfterFirst,
        filesAfterFirst.map((f) => f.replace(/^\d{2}-\d{2}_whatsapp_/, '').replace(/_[^_]*\.md$/, '')),
        [second.chats, second.messages, second.held, Object.keys(afterSecond.held)],
        [afterSecond.chats.c6?.known, Boolean(afterSecond.chats.c6?.cursor)],
        filesAfterSecond.length,
      ],
      expected: [
        [3, 3, [{ chat: '+1 (555) 010-2277', network: 'WhatsApp' }]],
        {
          c6: {
            network: 'WhatsApp',
            who: '+1 (555) 010-2277',
            first: 'Reply STOP to end.',
            at: '2026-03-11T09:00:00Z',
            count: 2,
          },
        },
        undefined,
        ['Maya', 'danak'],
        [3, 2, [], []],
        [true, true],
        3,
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
