import { assert, test } from '#test'
import type { BeeperSyncState } from './capture.ts'
import type { BeeperChat, ChatSearch } from './client.ts'
import { previewBeeper } from './preview.ts'

const chat = (extra: Partial<BeeperChat> & Pick<BeeperChat, 'id' | 'accountID' | 'title'>): BeeperChat => ({
  network: '',
  type: 'single',
  lastActivity: '2026-03-11T08:00:00Z',
  ...extra,
})

test('beeper preview - every pile, every chat, with the capture’s verdict and reason', async () => {
  const piles: Record<string, BeeperChat[]> = {
    primary: [
      chat({ id: 'p1', accountID: 'whatsapp', network: 'WhatsApp', title: 'Maya Okafor' }),
      chat({ id: 'p6', accountID: 'whatsapp', network: 'WhatsApp', title: '+1 (555) 010-2277' }),
      chat({ id: 'p2', accountID: 'whatsapp', network: 'WhatsApp', title: 'Atlas launch team', type: 'group' }),
      chat({
        id: 'p3',
        accountID: 'whatsapp',
        network: 'WhatsApp',
        title: 'Noisy group',
        type: 'group',
        isMuted: true,
      }),
      chat({ id: 'p4', accountID: 'signal', network: 'Signal', title: 'Priya Natarajan' }),
      chat({ id: 'p5', accountID: 'slack', network: 'Slack', title: 'atlas-gtm', type: 'group' }),
    ],
    'low-priority': [
      chat({ id: 'l1', accountID: 'whatsapp', network: 'WhatsApp', title: 'Deals', isLowPriority: true }),
    ],
    archive: [chat({ id: 'a1', accountID: 'whatsapp', network: 'WhatsApp', title: 'Old team', isArchived: true })],
  }
  const asked: string[] = []
  const client = {
    accounts: async () => [
      { accountID: 'whatsapp', network: 'WhatsApp', bridge: { id: 'w', type: 'whatsapp' } },
      { accountID: 'signal', network: 'Signal' },
      { accountID: 'slack', network: 'Slack', bridge: { id: 's', type: 'slackgo' } },
    ],
    searchChats: async (params: ChatSearch = {}) => {
      asked.push(`${params.inbox} muted=${params.includeMuted} after ${params.lastActivityAfter}`)
      return { items: piles[params.inbox ?? 'primary'] ?? [], hasMore: params.inbox === 'archive' }
    },
  }
  const state: BeeperSyncState = {
    version: 1,
    chats: {},
    held: {},
    accounts: { whatsapp: { network: 'WhatsApp', save: true, groups: false, holdUnknown: true, chosen: true } },
  }
  const preview = await previewBeeper({ client, state, now: '2026-03-11T13:00:00Z' })
  assert({
    given:
      'WhatsApp on without groups and holding unknown senders, Signal never chosen, a Slack account, and chats in all three piles',
    should:
      'ask each pile with muted chats included, judge every chat the way the capture would, and add a rule for Signal',
    actual: [asked, preview.complete, preview.rows, state.accounts.signal],
    expected: [
      [
        'primary muted=true after 2026-02-09T13:00:00Z',
        'low-priority muted=true after 2026-02-09T13:00:00Z',
        'archive muted=true after 2026-02-09T13:00:00Z',
      ],
      false,
      [
        { chat: 'Maya Okafor', network: 'WhatsApp', group: false, pile: 'primary', save: true },
        {
          chat: '+1 (555) 010-2277',
          network: 'WhatsApp',
          group: false,
          pile: 'primary',
          save: false,
          reason: 'held: unknown sender',
        },
        {
          chat: 'Atlas launch team',
          network: 'WhatsApp',
          group: true,
          pile: 'primary',
          save: false,
          reason: 'groups are off for WhatsApp',
        },
        { chat: 'Noisy group', network: 'WhatsApp', group: true, pile: 'primary', save: false, reason: 'muted' },
        {
          chat: 'Priya Natarajan',
          network: 'Signal',
          group: false,
          pile: 'primary',
          save: false,
          reason: 'Signal is off',
        },
        {
          chat: 'atlas-gtm',
          network: 'Slack',
          group: true,
          pile: 'primary',
          save: false,
          reason: 'saved through Sky’s Slack connection',
        },
        { chat: 'Deals', network: 'WhatsApp', group: false, pile: 'low-priority', save: false, reason: 'low priority' },
        { chat: 'Old team', network: 'WhatsApp', group: false, pile: 'archive', save: false, reason: 'archived' },
      ],
      { network: 'Signal', save: false, groups: false, holdUnknown: true, chosen: false },
    ],
  })
})
