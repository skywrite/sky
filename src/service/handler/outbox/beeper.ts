import { BeeperClient, BeeperError, beeperText, grantExpired, loadBeeperGrant } from '#lib/beeper/mod.ts'
import { OutboxError, type OutboxRecord } from '#lib/outbox/types.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'

/**
 * Outbox's side of Beeper: the draft goes into the chat's composer in Beeper
 * Desktop, the way a Slack or Gmail draft goes into its app, and the person
 * presses Send there. Beeper fills only an empty composer, which is the
 * safety Outbox wants: nothing the person typed is ever replaced.
 */

export type BeeperTarget = Extract<NonNullable<OutboxRecord['conversation']['target']>, { medium: 'Beeper' }>

export type BeeperDraftClient = Pick<BeeperClient, 'chat' | 'setDraft' | 'focus'>

/** Beeper's local API under the stored grant; a clear refusal when Sky is not connected. */
export async function beeperOutboxClient(secrets: SecretsProvider): Promise<BeeperClient> {
  const grant = await loadBeeperGrant(secrets)
  if (!grant) throw new OutboxError('Connect Beeper in Settings before Sky can reach this chat.', 409)
  if (grantExpired(grant)) throw new OutboxError('The Beeper connection expired. Reconnect Beeper in Settings.', 409)
  return new BeeperClient(grant.token)
}

/** A Beeper failure as the page reads it; anything else passes through. */
export function outboxErrorFromBeeper(error: unknown): unknown {
  if (!(error instanceof BeeperError)) return error
  return new OutboxError(error.message, error.kind === 'unavailable' ? 503 : error.kind === 'unauthorized' ? 409 : 400)
}

const plain = (text: string) => beeperText(text).replace(/\s+/g, ' ').trim()

/** Only called after approval. A draft the person typed or changed in Beeper is never replaced. */
export async function checkBeeperDraft(client: BeeperDraftClient, target: BeeperTarget, item: OutboxRecord) {
  const chat = await client.chat(target.chat)
  const current = plain(chat.draft?.text ?? '')
  if (!current) return
  if (!item.native) throw new OutboxError('There is already a draft in this Beeper chat. Review it in Beeper first.')
  if (current !== plain(item.reviews.at(-1)?.final ?? ''))
    throw new OutboxError('This draft changed in Beeper. Review those changes in Beeper before replacing it.')
}

/** Beeper fills only an empty composer, so replacing Sky's earlier wording clears it first. */
export async function placeBeeperDraft(
  client: BeeperDraftClient,
  target: BeeperTarget,
  text: string,
  replacing: boolean,
): Promise<{ id: string; url: string }> {
  if (replacing) await client.setDraft(target.chat, '')
  await client.setDraft(target.chat, text)
  return { id: target.chat, url: '' }
}

/** Bring Beeper Desktop to the front on this chat; the draft, if placed, is already in its composer. */
export async function openBeeperChat(client: BeeperDraftClient, target: BeeperTarget): Promise<void> {
  const result = await client.focus({ chatID: target.chat })
  if (!result.success) throw new OutboxError('Beeper could not open this chat.', 503)
}
