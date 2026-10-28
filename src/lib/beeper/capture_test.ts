import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { MessageDayCategoryInput } from '#lib/messageDayCategory.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import MessageDocument from '#shared/models/Message/document/mod.ts'
import { dayAttachmentsDir, dayDir, dayFile, writeDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { type BeeperSource, chatLabel, loadBeeperSyncState, markKnown, syncBeeper } from './capture.ts'
import type { BeeperAccount, BeeperChat, BeeperMessage, ChatSearch } from './client.ts'

type World = {
  chats: BeeperChat[]
  messages: Record<string, BeeperMessage[]>
  asset: string
  /** Accounts beside the WhatsApp and Slack ones every world has */
  accounts?: BeeperAccount[]
}

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
      ...(world.accounts ?? []),
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

test('beeper capture categorizes new iMessage day entries without metadata or later category changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-day-category-'))
  const timeDir = path.join(root, 'time')
  const stateFile = path.join(root, 'sync.json')
  const day = PlainDate.fromString('2026-03-11')
  const previousDay = day.addDays(-7)
  const cases = [
    { id: 'family', name: 'Alex Doe', text: 'Picnic at noon', network: 'iMessage' },
    { id: 'client', name: 'Jordan Lee', text: 'Invoice for Atlas', network: 'iMessage' },
    { id: 'unknown', name: 'Sam Quinn', text: 'Catch up', network: 'iMessage' },
    { id: 'other', name: 'Taylor Quinn', text: 'Meeting agenda', network: 'WhatsApp' },
  ]
  const world: World = {
    asset: '',
    accounts: [{ accountID: 'imessage', network: 'iMessage' }],
    chats: cases.map((item) => ({
      id: item.id,
      accountID: item.network.toLowerCase(),
      network: item.network,
      type: 'single',
      title: item.name,
      participants: { items: [{ id: item.id, fullName: item.name }] },
      lastActivity: '2026-03-11T09:00:00Z',
    })),
    messages: Object.fromEntries(
      cases.map((item) => [
        item.id,
        [
          message(item.id, '0001', '2026-03-11T09:00:00Z', item.text, {
            accountID: item.network.toLowerCase(),
            senderName: item.name,
            senderID: item.id,
          }),
        ],
      ]),
    ),
  }
  const calls: MessageDayCategoryInput[] = []
  const options = {
    client: beeperWith(world),
    timeDir,
    stateFile,
    attachmentsDir: path.join(root, 'attachments'),
    timezone: 'UTC',
    dayTimezone: async () => 'UTC',
    ownerName: 'Jane Doe',
    categorizeIMessage: async (input: MessageDayCategoryInput) => {
      calls.push(input)
      if (input.from === 'Sam Quinn') throw new Error('Synthetic classifier outage')
      return input.from === 'Jordan Lee' ? ('Professional' as const) : ('Personal' as const)
    },
  }
  try {
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        chats: {},
        accounts: {
          imessage: { network: 'iMessage', save: true, holdUnknown: false, chosen: true },
          whatsapp: { network: 'WhatsApp', save: true, holdUnknown: false, chosen: true },
        },
      }),
    )
    await writeDay(DayDocument.createPastDay(day), timeDir)
    await writeDay(
      DayDocument.createPastDay(previousDay).addCompleteItem('An older iMessage', { time: '09:00' }),
      timeDir,
    )
    const oldFile = path.join(timeDir, dayFile(previousDay))
    const oldText = await readTextFile(oldFile)
    const first = await syncBeeper({ ...options, now: '2026-03-11T09:05:00Z' })
    const state = await loadBeeperSyncState(stateFile)
    const docs = await Promise.all(
      cases.map(async (item) =>
        MessageDocument.fromMarkdown(await readTextFile(path.join(root, state.chats[item.id].files[day.ymd]))),
      ),
    )
    const dailyFile = path.join(timeDir, dayFile(day))
    const daily = DayDocument.fromMarkdown(await readTextFile(dailyFile))
    const placement = cases.map(
      (item) => daily.lists.find((list) => list.items.some((row) => row.includes(item.text)))?.title,
    )
    assert({
      given: 'personal and business iMessages, a failed classifier, and a different network',
      should: 'route only the day entries, favor Personal on failure, keep other networks and older days intact',
      actual: [
        placement,
        docs.map((doc) => Object.hasOwn(doc.yaml, 'category')),
        calls.length,
        calls[0].body.includes('Picnic at noon'),
        calls[0].participants?.includes('Alex Doe'),
        first.notes.some((note) => note.includes('filed under Personal')),
        (await readTextFile(oldFile)) === oldText,
        daily.lists.map((list) => list.title),
      ],
      expected: [
        ['Personal Complete', 'Professional Complete', 'Personal Complete', 'Professional Complete'],
        [false, false, false, false],
        3,
        true,
        true,
        true,
        true,
        ['Professional Complete', 'Personal Complete'],
      ],
    })

    // A person may correct the section after capture; appending must preserve that choice.
    const personal = daily.lists.find((list) => list.title === 'Personal Complete')!
    const at = personal.items.findIndex((item) => item.includes('Picnic at noon'))
    await writeDay(daily.removeItem(personal.title, at).addItem('Professional Complete', personal.items[at]), timeDir)
    const correctedDay = await readTextFile(dailyFile)
    world.messages.family.push(
      message('family', '0002', '2026-03-11T09:10:00Z', 'Bringing lunch', { accountID: 'imessage' }),
    )
    world.chats[0].lastActivity = '2026-03-11T09:10:00Z'
    await syncBeeper({ ...options, now: '2026-03-11T09:15:00Z' })
    await syncBeeper({ ...options, now: '2026-03-11T09:16:00Z' })
    assert({
      given: 'a manual day-section correction followed by a reply and a repeated sync',
      should: 'append once, preserve the section and avoid additional categorization or duplicate entries',
      actual: [
        (await readTextFile(dailyFile)) === correctedDay,
        calls.length,
        (await readTextFile(path.join(root, state.chats.family.files[day.ymd]))).split('Bringing lunch').length - 1,
      ],
      expected: [true, 3, 1],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('beeper iMessage defaults, explicit categories and dry runs do not depend on the model', async () => {
  for (const mode of ['default', 'explicit', 'dry'] as const) {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-category-default-'))
    const stateFile = path.join(root, 'sync.json')
    const timeDir = path.join(root, 'time')
    let calls = 0
    try {
      await writeFile(
        stateFile,
        JSON.stringify({
          version: 1,
          chats: {},
          accounts: {
            imessage: { network: 'iMessage', save: true, holdUnknown: false, chosen: true },
          },
        }),
      )
      const world: World = {
        asset: '',
        accounts: [{ accountID: 'imessage', network: 'iMessage' }],
        chats: [
          {
            id: 'one',
            accountID: 'imessage',
            network: 'iMessage',
            type: 'single',
            title: 'Alex Doe',
            lastActivity: '2026-03-11T09:00:00Z',
          },
        ],
        messages: { one: [message('one', '1', '2026-03-11T09:00:00Z', 'Dinner', { accountID: 'imessage' })] },
      }
      await syncBeeper({
        client: beeperWith(world),
        timeDir,
        stateFile,
        attachmentsDir: path.join(root, 'attachments'),
        now: '2026-03-11T09:05:00Z',
        timezone: 'UTC',
        dayTimezone: async () => 'UTC',
        category: mode === 'explicit' ? 'Professional' : undefined,
        dryRun: mode === 'dry',
        categorizeIMessage:
          mode === 'default'
            ? undefined
            : async () => {
                calls++
                return 'Personal'
              },
      })
      const dayText = await readFile(path.join(timeDir, dayFile('2026-03-11')), 'utf8').catch(() => null)
      const category =
        dayText === null
          ? null
          : DayDocument.fromMarkdown(dayText).lists.find((list) => list.items.some((row) => row.includes('Dinner')))
              ?.title
      assert({
        given: mode,
        should: 'default to Personal, honor the explicit choice, or leave a dry run unwritten without model calls',
        actual: [category, calls],
        expected: [mode === 'dry' ? null : mode === 'explicit' ? 'Professional Complete' : 'Personal Complete', 0],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('beeper capture - generated group titles resolve handles and preserve custom names and unknown people', () => {
  const contacts: Record<string, string> = {
    '+1 (555) 010-1001': 'Maya Okafor',
    'jane@example.com': 'Jane Doe',
  }
  const names = {
    resolve: (handle: string) => {
      const name = contacts[handle]
      return name ? { name, known: true } : null
    },
  }
  const label = (title: string) =>
    chatLabel({ id: 'g1', accountID: 'imessage', network: 'iMessage', type: 'group', title }, undefined, names)
  assert({
    given: 'formatted numbers, email handles, unknown recipients and deliberately named groups',
    should: 'resolve complete handle lists even without participant metadata, leaving custom titles intact',
    actual: [
      label('+1 (555) 010-1001, jane@example.com & +1 555-010-9999'),
      label('jane@example.com & nobody@example.com'),
      label('+1 (555) 010-1001, jane@example.com & 7 others'),
      label('+1 (555) 010-1001 & 1 other'),
      label('Atlas R&D, 2026'),
      label('Atlas @ Home'),
      label(''),
    ],
    expected: [
      'Maya Okafor, Jane Doe, +1 555-010-9999',
      'Jane Doe, nobody@example.com',
      'Maya Okafor, Jane Doe & 7 others',
      'Maya Okafor & 1 other',
      'Atlas R&D, 2026',
      'Atlas @ Home',
      'Group',
    ],
  })
})

test('beeper capture - resolved group names reach recipients, filenames, day entries and existing captures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-group-names-'))
  const timeDir = path.join(root, 'time')
  const stateFile = path.join(root, 'sync.json')
  const day = PlainDate.fromString('2026-03-11')
  const title = '+1 (555) 010-1001 & jane@example.com'
  const resolved = 'Maya Okafor, Jane Doe'
  const world: World = {
    asset: '',
    accounts: [{ accountID: 'imessage', network: 'iMessage' }],
    chats: [
      {
        id: 'g1',
        accountID: 'imessage',
        network: 'iMessage',
        type: 'group',
        title,
        lastActivity: '2026-03-11T09:00:00Z',
      },
    ],
    messages: { g1: [message('g1', '0001', '2026-03-11T09:00:00Z', 'Picnic at noon', { accountID: 'imessage' })] },
  }
  try {
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        chats: {},
        accounts: { imessage: { network: 'iMessage', save: true, groups: true, holdUnknown: true, chosen: true } },
      }),
    )
    const options = {
      timeDir,
      attachmentsDir: path.join(root, 'attachments'),
      stateFile,
      client: beeperWith(world),
      timezone: 'UTC',
      dayTimezone: async () => 'UTC',
      names: {
        resolve: (handle: string) => ({ name: handle.includes('@') ? 'Jane Doe' : 'Maya Okafor', known: true }),
      },
    }
    const first = await syncBeeper({ ...options, now: '2026-03-11T09:05:00Z' })
    const state = await loadBeeperSyncState(stateFile)
    const relative = state.chats.g1.files[day.toString()]
    const file = path.join(root, relative)
    const doc = MessageDocument.fromMarkdown(await readTextFile(file))
    const dayText = await readTextFile(path.join(timeDir, dayFile(day)))
    assert({
      given: 'an unnamed iMessage group whose recipients are known',
      should: 'use their names consistently in the saved message and day entry',
      actual: [
        first.messages,
        doc.to,
        path.basename(relative),
        dayText.includes(`${resolved} iMessage -> [Picnic at noon]`),
      ],
      expected: [1, resolved, '09-00_imessage_Maya-Okafor-Jane-Doe_Picnic-at-noon.md', true],
    })

    // A capture made before the name lookup existed still has its original recipient list.
    await writeFile(file, new MessageDocument({ ...doc.yaml, to: title }, doc.markdown).toMarkdown())
    world.messages.g1.push(message('g1', '0002', '2026-03-11T09:10:00Z', 'Bringing lunch', { accountID: 'imessage' }))
    world.chats[0].lastActivity = '2026-03-11T09:10:00Z'
    const second = await syncBeeper({ ...options, now: '2026-03-11T09:15:00Z' })
    const updated = MessageDocument.fromMarkdown(await readTextFile(file))
    const afterSecond = await loadBeeperSyncState(stateFile)
    assert({
      given: 'a new reply appended to a capture whose recipients are still raw handles',
      should: 'resolve the existing recipients and append the reply without renaming the file or losing prior messages',
      actual: [
        second.messages,
        updated.to,
        updated.markdown.includes('Picnic at noon'),
        updated.markdown.includes('Bringing lunch'),
        afterSecond.chats.g1.files[day.toString()],
      ],
      expected: [1, resolved, true, true, relative],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('beeper capture - Screen Time notifications stay out while people in the same chat still land', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-screen-time-'))
  const timeDir = path.join(root, 'time')
  const attachmentsDir = path.join(root, 'attachments')
  const stateFile = path.join(root, 'sync.json')
  const day = PlainDate.fromString('2026-03-11')
  const notification = '{{sender}} sent a message from ScreenTimeRequest'
  const world: World = {
    asset: '',
    accounts: [{ accountID: 'imessage', network: 'iMessage', user: { id: 'me' } }],
    chats: [
      {
        id: 'i1',
        accountID: 'imessage',
        network: 'iMessage',
        title: 'Doe family',
        type: 'group',
        lastActivity: '2026-03-11T09:00:00Z',
      },
    ],
    messages: {
      i1: [
        message('i1', '0001', '2026-03-11T09:00:00Z', notification, {
          accountID: 'imessage',
          attachments: [{ type: 'img', srcURL: 'mxc://example.com/request', fileName: 'request.png' }],
        }),
      ],
    },
  }
  try {
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        chats: {},
        accounts: { imessage: { network: 'iMessage', save: true, groups: true, holdUnknown: true, chosen: true } },
      }),
    )
    const client = beeperWith(world)
    const options = { timeDir, attachmentsDir, stateFile, client, timezone: 'UTC', dayTimezone: async () => 'UTC' }
    const first = await syncBeeper({ ...options, now: '2026-03-11T09:05:00Z' })
    const afterFirst = await loadBeeperSyncState(stateFile)
    assert({
      given: 'a group chat containing only an automated Screen Time request with an attachment',
      should: 'advance past it without creating notebook content or downloading its attachment',
      actual: [
        first.messages,
        first.files,
        await readdir(timeDir).catch(() => []),
        client.calls.some((call) => call.startsWith('download ')),
        afterFirst.chats.i1?.newest,
      ],
      expected: [0, [], [], false, '2026-03-11T09:00:00Z'],
    })

    const humanText = 'Screen time is paused until dinner. The ScreenTimeRequest setting is enabled.'
    world.messages.i1.push(
      message('i1', '0002', '2026-03-11T09:10:00Z', humanText, { accountID: 'imessage' }),
      message('i1', '0003', '2026-03-11T09:15:00Z', `<p>${notification}</p>`, { accountID: 'imessage' }),
    )
    world.chats[0].lastActivity = '2026-03-11T09:15:00Z'
    const second = await syncBeeper({ ...options, now: '2026-03-11T09:30:00Z' })
    const afterSecond = await loadBeeperSyncState(stateFile)
    const saved = path.join(root, afterSecond.chats.i1.files[day.toString()])
    const text = await readTextFile(saved)
    const dayText = await readTextFile(path.join(timeDir, dayFile(day)))
    const third = await syncBeeper({ ...options, now: '2026-03-11T09:31:00Z' })
    assert({
      given: 'a person discussing Screen Time between notifications, followed by a repeat sync',
      should: 'save their message and day entry once, excluding both plain and HTML notifications',
      actual: [
        second.messages,
        second.files.length,
        text.includes(humanText),
        text.includes(notification),
        dayText.includes('Screen time is paused until dinner.'),
        afterSecond.chats.i1.newest,
        third.messages,
        (await readTextFile(saved)) === text,
        client.calls.some((call) => call.startsWith('download ')),
      ],
      expected: [1, 1, true, false, true, '2026-03-11T09:15:00Z', 0, true, false],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('beeper capture - a chat the owner opens reads owner to them, in Beeper order, without the timer event', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-direction-'))
  const timeDir = path.join(root, 'time')
  const attachmentsDir = path.join(root, 'attachments')
  const stateFile = path.join(root, 'sync.json')
  const day = PlainDate.fromString('2026-03-11')
  const opened = '2026-03-11T09:00:00Z'
  const signal = { accountID: 'signal' }
  const timer = 'New messages set to disappear after 7 days'
  const world: World = {
    asset: '',
    accounts: [{ accountID: 'signal', network: 'Signal', user: { id: 'me', fullName: 'Jane Doe', isSelf: true } }],
    chats: [
      {
        id: 's1',
        accountID: 'signal',
        network: 'Signal',
        title: 'Maya Okafor',
        type: 'single',
        participants: {
          items: [
            { id: 'u1', fullName: 'Maya Okafor' },
            { id: 'me', fullName: 'Jane Doe', isSelf: true },
          ],
        },
        lastActivity: '2026-03-11T09:05:00Z',
      },
    ],
    messages: {
      // Beeper's shape when the owner opens a Signal chat: the timer event, its hidden
      // notice and the first messages share one instant, ordered by number-valued sort keys
      s1: [
        message('s1', '7', opened, timer, { ...signal, isSender: true, type: undefined }),
        message('s1', '8', opened, 'Automatically enabled disappearing message timer', {
          ...signal,
          isSender: true,
          type: 'NOTICE',
          isHidden: true,
        }),
        message('s1', '99', opened, 'Lunch on Thursday?', { ...signal, isSender: true }),
        message('s1', '100', opened, 'I can book a table.', { ...signal, isSender: true }),
        message('s1', '101', '2026-03-11T09:05:00Z', 'Works for me!', signal),
      ],
    },
  }
  try {
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        chats: {},
        accounts: { signal: { network: 'Signal', save: true, groups: true, holdUnknown: false, chosen: true } },
      }),
    )
    const client = beeperWith(world)
    const options = { timeDir, attachmentsDir, stateFile, client, timezone: 'UTC', dayTimezone: async () => 'UTC' }
    const result = await syncBeeper({ ...options, now: '2026-03-11T09:10:00Z' })
    const state = await loadBeeperSyncState(stateFile)
    const doc = MessageDocument.fromMarkdown(await readTextFile(path.join(root, state.chats.s1.files[day.toString()])))
    assert({
      given: 'a Signal chat the owner opens, with the timer event at the same instant and a reply after',
      should: 'save it from the owner to the other person, in Beeper order, leaving the timer event out',
      actual: [
        result.messages,
        [doc.yaml.from, doc.yaml.to, doc.summary],
        [...doc.markdown.matchAll(/- \*\*(.+?)\*\*\n\n(.+)/g)].map((m) => `${m[1]}: ${m[2]}`),
        doc.markdown.includes(timer),
      ],
      expected: [
        3,
        ['Jane Doe', 'Maya Okafor', 'Lunch on Thursday?'],
        ['Jane Doe: Lunch on Thursday?', 'Jane Doe: I can book a table.', 'Maya Okafor: Works for me!'],
        false,
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('beeper capture - the owner is saved under the notebook name, not the network profile name', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-owner-name-'))
  const timeDir = path.join(root, 'time')
  const attachmentsDir = path.join(root, 'attachments')
  const stateFile = path.join(root, 'sync.json')
  const day = PlainDate.fromString('2026-03-11')
  const signal = { accountID: 'signal' }
  const world: World = {
    asset: '',
    accounts: [{ accountID: 'signal', network: 'Signal', user: { id: 'me', fullName: 'JD', isSelf: true } }],
    chats: [
      {
        id: 's1',
        accountID: 'signal',
        network: 'Signal',
        title: 'Maya Okafor',
        type: 'single',
        participants: {
          items: [
            { id: 'u1', fullName: 'Maya Okafor' },
            { id: 'me', fullName: 'JD', isSelf: true },
          ],
        },
        lastActivity: '2026-03-11T09:05:00Z',
      },
    ],
    messages: {
      s1: [
        message('s1', '1', '2026-03-11T09:00:00Z', 'Lunch on Thursday?', {
          ...signal,
          isSender: true,
          senderName: 'JD',
        }),
        message('s1', '2', '2026-03-11T09:05:00Z', 'Works for me!', signal),
      ],
    },
  }
  try {
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        chats: {},
        accounts: { signal: { network: 'Signal', save: true, groups: true, holdUnknown: false, chosen: true } },
      }),
    )
    const client = beeperWith(world)
    const options = { timeDir, attachmentsDir, stateFile, client, timezone: 'UTC', dayTimezone: async () => 'UTC' }
    await syncBeeper({ ...options, ownerName: 'Jane Doe', now: '2026-03-11T09:10:00Z' })
    const state = await loadBeeperSyncState(stateFile)
    const doc = MessageDocument.fromMarkdown(await readTextFile(path.join(root, state.chats.s1.files[day.toString()])))
    assert({
      given: 'a Signal profile that names the owner JD while the notebook names them Jane Doe',
      should: 'save the owner as Jane Doe in from and on their messages',
      actual: [[doc.yaml.from, doc.yaml.to], [...doc.markdown.matchAll(/- \*\*(.+?)\*\*/g)].map((m) => m[1])],
      expected: [
        ['Jane Doe', 'Maya Okafor'],
        ['Jane Doe', 'Maya Okafor'],
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

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
    const day10Text = await readTextFile(path.join(timeDir, dayFile(PlainDate.fromString('2026-03-10'))))
    const saved = await readdir(path.join(attachmentsDir, dayAttachmentsDir(day11)))
    const state = await loadBeeperSyncState(stateFile)
    assert({
      given: 'two WhatsApp chats with three days of talk, a read-only channel, and a Slack chat',
      should:
        'write nothing on a dry run, then a file per chat per day with the right names, links, and day entries, creating a missing day file',
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
        day10Text.includes('09:12 > Maya WhatsApp -> ['),
        [state.lastSync, state.chats.c1?.newest, state.chats.c1?.seen, Object.keys(state.chats.c1?.files ?? {})],
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
        [],
        true,
        [
          '2026-03-11T13:00:00Z',
          '2026-03-11T08:07:00Z',
          ['c1-0001', 'c1-0002', 'c1-0003'],
          ['2026-03-10', '2026-03-11'],
        ],
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
        're-list recent chats with some overlap, append what is new without a new file, and leave the file alone afterwards',
      actual: [
        client.calls,
        [second.chats, second.messages, second.files, (await messagesOf('2026-03-11')).length],
        grown.endsWith('## 2026-03-11 13:30 - **Maya Okafor**\n\nThanks!\n'),
        MessageDocument.fromMarkdown(grown).attachments,
        [third.chats, third.messages, third.files.length, again === grown],
      ],
      expected: [
        ['search after 2026-03-11T07:00:00Z', 'messages c1 first', 'messages c2 first'],
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
        'save the contact and the answered handle, hold the bare number with no file and nothing kept, then save it once marked known',
      actual: [
        [first.chats, first.messages, first.held],
        heldAfterFirst,
        c6AfterFirst,
        filesAfterFirst.map((f) => f.replace(/^\d{2}-\d{2}_whatsapp_/, '').replace(/_[^_]*\.md$/, '')),
        [second.chats, second.messages, second.held, Object.keys(afterSecond.held)],
        [afterSecond.chats.c6?.known, Boolean(afterSecond.chats.c6?.newest)],
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

test('beeper capture - names from this Mac: a number Contacts know is saved under its name, one the phone filed as known is saved, the rest is held', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-mac-names-'))
  const timeDir = path.join(root, 'time')
  const attachmentsDir = path.join(root, 'attachments')
  const stateFile = path.join(root, 'state', 'beeper', 'sync.json')
  // Beeper's iMessage: the chat and its participants carry numbers and nothing else
  const text = (id: string, number: string, shown: string): BeeperChat => ({
    id,
    accountID: 'imessage',
    network: 'iMessage',
    title: shown,
    type: 'single',
    participants: {
      items: [
        { id: `${id}-p`, phoneNumber: number },
        { id: 'me3', phoneNumber: '+15550100001', isSelf: true },
      ],
    },
    lastActivity: '2026-03-11T09:00:00Z',
  })
  const world: World = {
    asset: '',
    accounts: [
      {
        accountID: 'imessage',
        network: 'iMessage',
        status: 'connected',
        user: { id: 'me3', phoneNumber: '+15550100001', isSelf: true },
        bridge: { id: 'local-imessage', type: 'imessage' },
      },
    ],
    chats: [
      text('i1', '+15550102277', '+1 (555) 010-2277'),
      text('i2', '+15550103000', '+1 (555) 010-3000'),
      text('i3', '+15550109999', '+1 (555) 010-9999'),
    ],
    messages: {
      i1: [
        message('i1', '0001', '2026-03-11T08:50:00Z', 'Lunch Thursday?', {
          accountID: 'imessage',
          senderID: 'i1-p',
          senderName: '+1 (555) 010-2277',
        }),
        message('i1', '0002', '2026-03-11T08:55:00Z', 'Yes, noon works.', {
          accountID: 'imessage',
          isSender: true,
          senderID: 'me3',
          senderName: '+1 (555) 010-0001',
        }),
      ],
      i2: [
        message('i2', '0001', '2026-03-11T08:58:00Z', 'Your table is ready.', {
          accountID: 'imessage',
          senderID: 'i2-p',
          senderName: '+1 (555) 010-3000',
        }),
      ],
      i3: [
        message('i3', '0001', '2026-03-11T09:00:00Z', 'Hi, this is Dana with the Atlas campaign.', {
          accountID: 'imessage',
          senderID: 'i3-p',
          senderName: '+1 (555) 010-9999',
        }),
      ],
    },
  }
  // This Mac: one number has a contact card, one the phone treats as known without a card
  const mac: Record<string, { name: string | null; known: boolean | null }> = {
    '+15550102277': { name: 'Maya Okafor', known: true },
    '+15550103000': { name: null, known: true },
  }
  const names = { resolve: (handle: string) => mac[handle] ?? null }
  await mkdir(path.dirname(stateFile), { recursive: true })
  await writeFile(
    stateFile,
    JSON.stringify({
      version: 1,
      chats: {},
      accounts: { imessage: { network: 'iMessage', save: true, groups: false, holdUnknown: true, chosen: true } },
    }),
  )
  try {
    const result = await syncBeeper({
      timeDir,
      attachmentsDir,
      stateFile,
      timezone: 'UTC',
      dayTimezone: async () => 'UTC',
      client: beeperWith(world),
      names,
      ownerName: 'Jane Doe',
      now: '2026-03-11T13:00:00Z',
    })
    const after = await loadBeeperSyncState(stateFile)
    const dir = path.join(timeDir, dayDir(PlainDate.fromString('2026-03-11')), 'actions', 'messages')
    const files = (await readdir(dir)).sort()
    const maya = MessageDocument.fromMarkdown(
      await readTextFile(
        path.join(
          dir,
          files.find((f) => f.includes('Maya'))!,
        ),
      ),
    )
    assert({
      given: 'iMessage chats that Beeper shows by number alone, with this Mac naming one and vouching for another',
      should:
        'save the named one under the contact’s name with the owner on the other side, save the vouched-for number whole, and hold the stranger',
      actual: [
        [result.chats, result.messages, result.held],
        files.map((f) => f.replace(/^\d{2}-\d{2}_imessage_/, '').replace(/_[^_]*\.md$/, '')),
        [maya.yaml.from, maya.yaml.to],
        [...maya.markdown.matchAll(/- \*\*(.+?)\*\*/g)].map((m) => m[1]),
        Object.keys(after.held),
      ],
      expected: [
        [3, 3, [{ chat: '+1 (555) 010-9999', network: 'iMessage' }]],
        ['Maya', '1-555-010-3000'],
        ['Maya Okafor', 'Jane Doe'],
        ['Maya Okafor', 'Jane Doe'],
        ['i3'],
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('beeper capture - a voice note without words from Beeper is transcribed by Sky, and the words name the message', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-voice-'))
  const timeDir = path.join(root, 'time')
  const attachmentsDir = path.join(root, 'attachments')
  const stateFile = path.join(root, 'state', 'beeper', 'sync.json')
  const asset = path.join(root, 'beeper-cache', 'voice.m4a')
  await mkdir(path.dirname(asset), { recursive: true })
  await writeFile(asset, new Uint8Array([1, 2, 3, 4]))
  const world: World = {
    asset,
    chats: [
      {
        id: 'c1',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: 'Maya Okafor',
        type: 'single',
        lastActivity: '2026-03-11T09:00:00Z',
        participants: { items: [{ id: 'u1', fullName: 'Maya Okafor' }] },
      },
    ],
    messages: {
      c1: [
        message('c1', '0001', '2026-03-11T08:05:00Z', '', {
          attachments: [{ id: 'mxc://atlas/2', type: 'audio', isVoiceNote: true, fileName: 'voice.m4a' }],
        }),
        message('c1', '0002', '2026-03-11T08:06:00Z', '', {
          attachments: [{ id: 'mxc://atlas/3', type: 'audio', isVoiceNote: true, fileName: 'voice2.m4a' }],
        }),
        message('c1', '0003', '2026-03-11T08:07:00Z', 'and the photo', {
          attachments: [{ id: 'mxc://atlas/4', type: 'img', fileName: 'site.png' }],
        }),
        message('c1', '0004', '2026-03-11T08:08:00Z', '', {
          attachments: [
            {
              id: 'mxc://atlas/5',
              type: 'audio',
              isVoiceNote: true,
              fileName: 'voice3.m4a',
              transcription: { transcription: 'Beeper heard this one' },
            },
          ],
        }),
      ],
    },
  }
  await writeDay(DayDocument.createPastDay(PlainDate.fromString('2026-03-11')), timeDir)
  await mkdir(path.dirname(stateFile), { recursive: true })
  await writeFile(
    stateFile,
    JSON.stringify({
      version: 1,
      chats: {},
      accounts: { whatsapp: { network: 'WhatsApp', save: true, groups: true, holdUnknown: false, chosen: true } },
    }),
  )
  const heard: string[] = []
  const result = await syncBeeper({
    client: beeperWith(world),
    timeDir,
    attachmentsDir,
    stateFile,
    timezone: 'UTC',
    dayTimezone: async () => 'UTC',
    now: '2026-03-11T10:00:00Z',
    transcribe: async (audio, fileName) => {
      heard.push(`${fileName}:${audio.byteLength}`)
      if (fileName === 'voice2.m4a') throw new Error('MacWhisper is not installed')
      return 'Running late, start the kickoff without me'
    },
    duration: async () => 4,
  })
  const dir = path.join(timeDir, dayDir(PlainDate.fromString('2026-03-11')), 'actions', 'messages')
  const [file] = (await readdir(dir)).sort()
  const text = await Bun.file(path.join(dir, file)).text()
  const dayText = await readTextFile(path.join(timeDir, dayFile(PlainDate.fromString('2026-03-11'))))
  assert({
    given: 'three voice notes — one Beeper never transcribed, one Sky cannot, one Beeper did — and a photo',
    should:
      'listen only where Beeper left no words, write the words inline, say voice note and its length after the name, name the file by the words, start the day line with Voice note, and list the failed one by file',
    actual: [
      heard,
      file,
      (text.match(/\*\* \(voice note, 0:04\)$/gm) ?? []).length,
      /- \*\*Maya Okafor\*\*\n\nand the photo/.test(text),
      dayText.includes(
        '08:05 > Maya WhatsApp -> [Voice note: Running late, start the kickoff without me](actions/messages/',
      ),
      /^summary: Running late, start the kickoff without me$/m.test(text),
      text.includes('🎤 Running late, start the kickoff without me'),
      text.includes('🎤 Beeper heard this one'),
      /📎 .*voice2\.m4a/.test(text),
      /📎 .*site\.png/.test(text),
      result.notes.filter((note) => note.includes('could not be transcribed')).length,
      result.notes.some((note) => note.includes('MacWhisper is not installed')),
    ],
    expected: [
      ['voice.m4a:4', 'voice2.m4a:4'],
      '08-05_whatsapp_Maya_Running-late-start-the-kickoff.md',
      3,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      1,
      true,
    ],
  })
  await rm(root, { recursive: true, force: true })
})

test('beeper capture - a sender whose number a people record carries is filed under the record’s name on any network', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-beeper-people-'))
  const timeDir = path.join(root, 'time')
  const attachmentsDir = path.join(root, 'attachments')
  const stateFile = path.join(root, 'state', 'beeper', 'sync.json')
  const world: World = {
    asset: path.join(root, 'none.png'),
    chats: [
      {
        id: 'c1',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: 'Maya O.',
        type: 'single',
        lastActivity: '2026-03-11T09:00:00Z',
        participants: { items: [{ id: 'u1', fullName: 'Maya O.', phoneNumber: '+1 (555) 010-2277' }] },
      },
      {
        id: 'g1',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: 'Atlas launch team',
        type: 'group',
        lastActivity: '2026-03-11T09:30:00Z',
        participants: {
          items: [
            { id: 'u1', fullName: 'Maya O.', phoneNumber: '+1 (555) 010-2277' },
            { id: 'u2', fullName: 'Sam Lee', phoneNumber: '+1 (555) 010-3000' },
          ],
        },
      },
    ],
    messages: {
      c1: [message('c1', '0001', '2026-03-11T08:05:00Z', 'Landed', { senderName: 'Maya O.' })],
      g1: [
        message('g1', '0001', '2026-03-11T09:20:00Z', 'Kickoff at 3', { senderName: 'Maya O.' }),
        message('g1', '0002', '2026-03-11T09:25:00Z', 'On it', { senderName: 'Sam Lee', senderID: 'u2' }),
      ],
    },
  }
  await writeDay(DayDocument.createPastDay(PlainDate.fromString('2026-03-11')), timeDir)
  await mkdir(path.dirname(stateFile), { recursive: true })
  await writeFile(
    stateFile,
    JSON.stringify({
      version: 1,
      chats: {},
      accounts: { whatsapp: { network: 'WhatsApp', save: true, groups: true, holdUnknown: false, chosen: true } },
    }),
  )
  await syncBeeper({
    client: beeperWith(world),
    timeDir,
    attachmentsDir,
    stateFile,
    timezone: 'UTC',
    dayTimezone: async () => 'UTC',
    now: '2026-03-11T10:00:00Z',
    names: {
      resolve: (handle) =>
        handle.replace(/\D/g, '').endsWith('5550102277')
          ? { name: 'Maya Okafor', known: true, source: 'notebook' }
          : null,
    },
  })
  const dir = path.join(timeDir, dayDir(PlainDate.fromString('2026-03-11')), 'actions', 'messages')
  const files = (await readdir(dir)).sort()
  const single = await readTextFile(
    path.join(
      dir,
      files.find((f) => f.includes('Maya'))!,
    ),
  )
  const group = await readTextFile(
    path.join(
      dir,
      files.find((f) => f.includes('Atlas'))!,
    ),
  )
  assert({
    given: 'a WhatsApp chat and a group where Beeper calls her Maya O., and a people record carrying her number',
    should:
      'name the file, from: and every heading of hers by the record, and leave the other sender as Beeper names him',
    actual: [
      files,
      /^from: Maya Okafor$/m.test(single),
      single.includes('- **Maya Okafor**'),
      group.includes('- **Maya Okafor**'),
      group.includes('- **Sam Lee**'),
      group.includes('Maya O.'),
    ],
    expected: [
      ['08-05_whatsapp_Maya_Landed.md', '09-20_whatsapp_Atlas-launch-team_Kickoff-at-3.md'],
      true,
      true,
      true,
      true,
      false,
    ],
  })
  await rm(root, { recursive: true, force: true })
})
