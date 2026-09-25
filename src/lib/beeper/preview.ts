import { Instant } from '#universal/dates/nbdt/mod.ts'
import { type BeeperSyncState, judgeChat, reconcileAccountRules, unknownSender } from './capture.ts'
import type { BeeperAccount, BeeperChat, BeeperClient, ChatSearch } from './client.ts'

/**
 * What a check would do, chat by chat, before anything is saved: every chat
 * Beeper filed anywhere in the last month, with the capture's own verdict and
 * reason. No messages are fetched, so it is quick and writes nothing. The
 * settings page shows it when a network is about to be switched on.
 */

export type BeeperPreviewSource = Pick<BeeperClient, 'accounts' | 'searchChats'>

export type PreviewPile = NonNullable<ChatSearch['inbox']>

export type PreviewRow = {
  chat: string
  network: string
  group: boolean
  pile: PreviewPile
  save: boolean
  reason?: string
}

export type BeeperPreview = {
  rows: PreviewRow[]
  /** False when a pile had more chats than the preview lists. */
  complete: boolean
}

const PILES: PreviewPile[] = ['primary', 'low-priority', 'archive']
const PER_PILE = 200

export async function previewBeeper(options: {
  client: BeeperPreviewSource
  state: BeeperSyncState
  /** When the preview runs, as an ISO instant. */
  now: string
  backfillDays?: number
}): Promise<BeeperPreview> {
  const since = Instant.fromEpochMilliseconds(
    Instant.from(options.now).epochMilliseconds - (options.backfillDays ?? 30) * 86_400_000,
  ).toString()
  const listed = await options.client.accounts()
  reconcileAccountRules(options.state, listed)
  const accounts = new Map<string, BeeperAccount>(listed.map((account) => [account.accountID, account]))
  const rows: PreviewRow[] = []
  let complete = true
  for (const pile of PILES) {
    const page = await options.client.searchChats({
      inbox: pile,
      includeMuted: true,
      type: 'any',
      lastActivityAfter: since,
      limit: PER_PILE,
    })
    if (page.hasMore) complete = false
    for (const chat of page.items) rows.push(row(chat, pile, accounts.get(chat.accountID), options.state))
  }
  return { rows, complete }
}

function row(
  chat: BeeperChat,
  pile: PreviewPile,
  account: BeeperAccount | undefined,
  state: BeeperSyncState,
): PreviewRow {
  const rule = state.accounts[chat.accountID]
  let verdict = judgeChat(chat, account, rule)
  // The capture also asks whether the person ever wrote there; the preview cannot without the messages.
  if (verdict.save && rule?.holdUnknown && !state.chats[chat.id]?.known && unknownSender(chat, account))
    verdict = { save: false, reason: 'held: unknown sender' }
  return {
    chat: chat.title || chat.id,
    network: chat.network.trim() || account?.network?.trim() || 'Beeper',
    group: chat.type === 'group',
    pile,
    save: verdict.save,
    ...(verdict.save ? {} : { reason: verdict.reason }),
  }
}
