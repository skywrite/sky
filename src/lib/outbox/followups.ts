import { generateObject } from 'ai'
import { z } from 'zod'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { hash } from './files.ts'
import { prepareConversationHistory } from './history.ts'
import { outboxModel, OUTBOX_MODEL_TIMEOUT_MS } from './model.ts'
import type { OutboxStore } from './store.ts'
import {
  FollowupProposalSchema,
  OutboxError,
  type Followup,
  type OutboxRecord,
  type PrepareFollowups,
} from './types.ts'

const PROMPT = new URL('./prompts/followups.prompt.md', import.meta.url).pathname
const Proposals = z.array(FollowupProposalSchema).max(4)
const normalizeRecipient = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

/** Accept typography changes in a quote, then retain the actual span from the approved reply. */
function quotedSpan(reply: string, quote: string): string | undefined {
  const fold = (text: string) => {
    let value = ''
    const spans: Array<{ start: number; end: number }> = []
    let offset = 0
    for (const character of text) {
      const next = /\s/u.test(character)
        ? ' '
        : /[‘’]/u.test(character)
          ? "'"
          : /[“”]/u.test(character)
            ? '"'
            : character
      if (next === ' ' && value.endsWith(' ')) {
        spans.at(-1)!.end = offset + character.length
      } else {
        value += next
        for (let index = 0; index < next.length; index++) spans.push({ start: offset, end: offset + character.length })
      }
      offset += character.length
    }
    return { value, spans }
  }
  const source = fold(reply)
  const target = fold(quote).value.trim()
  const at = target ? source.value.indexOf(target) : -1
  return at < 0 ? undefined : reply.slice(source.spans[at].start, source.spans[at + target.length - 1].end)
}
export const canQueueFollowups = (parent: OutboxRecord) =>
  parent.status === 'ready' || Boolean(parent.delivery) || (parent.status === 'dismissed' && Boolean(parent.native))

export function createFollowupPlanner(
  model: () => ResolvedModel = outboxModel,
  write?: import('#lib/writingVoice/types.ts').VoiceWriter,
): PrepareFollowups {
  return async ({ item, reply, preferences }) => {
    const context = {
      approvedReply: reply,
      preferences,
      originalRecipient: item.recipient,
      situation: item.situation,
      followupOf: item.followupOf,
    }
    const history = await prepareConversationHistory(item.conversation, context, model)
    const result = await generateObject({
      ...model(),
      schema: z.object({ followups: Proposals }),
      instructions: renderPromptFile(await readPromptFile(PROMPT), PROMPT, {}).output,
      prompt: JSON.stringify({ ...context, ...history }),
      abortSignal: AbortSignal.timeout(OUTBOX_MODEL_TIMEOUT_MS),
    })
    return Promise.all(
      result.object.followups.map(async (followup) =>
        write
          ? {
              ...followup,
              draft: (
                await write({
                  meaning: followup.draft,
                  medium: 'Message',
                  recipient: followup.recipient,
                  context: followup.situation,
                })
              ).draft,
            }
          : followup,
      ),
    )
  }
}

/** Validate at the approval boundary, including injected planners, before saving any intent. */
export async function prepareFollowups(
  store: OutboxStore,
  item: OutboxRecord,
  reply: string,
  prepare?: PrepareFollowups,
): Promise<Followup[] | undefined> {
  if (!prepare) return undefined
  const proposals = Proposals.parse(await prepare({ item, reply, preferences: (await store.preferences()).text }))
  const recipients = new Set<string>()
  return proposals.map((proposal) => {
    const recipient = normalizeRecipient(proposal.recipient)
    const escaped = recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const named = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u')
    const commitment = quotedSpan(reply, proposal.commitment)
    if (!commitment || !named.test(normalizeRecipient(commitment)))
      throw new OutboxError('Sky could not match a follow-up to your approved wording. Retry the follow-up drafts.')
    if (recipients.has(recipient))
      throw new OutboxError('Sky repeated a follow-up recipient. Retry the follow-up drafts.')
    recipients.add(recipient)
    return {
      ...proposal,
      commitment,
      // Deterministic on purpose: a repeated approval must find the child it already queued.
      // This is the dedup exception in AGENTS.md § IDs for User Content; scanner items use readable ids.
      id: hash(`followup:${item.id}:${item.conversation.version}:${recipient}`).slice(0, 32),
    }
  })
}

/** The parent is the durable intent. Repeating this local write never overwrites an existing child. */
export async function queueFollowups(store: OutboxStore, parent: OutboxRecord): Promise<OutboxRecord[]> {
  if (!canQueueFollowups(parent)) return []
  const items: OutboxRecord[] = []
  for (const followup of parent.followups ?? []) {
    const existing = await store.get(followup.id)
    if (existing) {
      if (existing.followupOf?.id !== parent.id)
        throw new OutboxError('The follow-up identity is already used by another item.', 409)
      items.push(existing)
      continue
    }
    const key = `followup:${followup.id}`
    const at = parent.reviews.at(-1)?.at ?? parent.delivery?.at ?? parent.updated
    try {
      items.push(
        await store.put(
          {
            id: followup.id,
            created: at,
            updated: at,
            status: 'needs_review',
            conversation: {
              key,
              version: hash(key),
              medium: parent.conversation.medium,
              sources: [],
              target: null,
              limitations: ['Copy this message into the recipient’s app. A native conversation has not been linked.'],
            },
            title: followup.title,
            situation: followup.situation,
            reasoning: 'Your approved reply calls for a separate message. Review this draft to follow through.',
            questions: [],
            originalDraft: followup.draft,
            draft: followup.draft,
            edited: false,
            stale: false,
            reviews: [],
            native: null,
            placementError: null,
            origin: 'followup',
            recipient: followup.recipient,
            followupOf: {
              id: parent.id,
              title: parent.title,
              reply: parent.followupContext?.reply ?? parent.draft,
              commitment: followup.commitment,
              at,
              sourceVersion: parent.followupContext?.sourceVersion ?? parent.conversation.version,
            },
          },
          null,
        ),
      )
    } catch (error) {
      const raced = await store.get(followup.id)
      if (!(error instanceof OutboxError) || error.status !== 409 || raced?.followupOf?.id !== parent.id) throw error
      items.push(raced)
    }
  }
  return items
}

/** A follow-up write failure must never make a confirmed native placement look ambiguous. */
export async function reconcileFollowups(store: OutboxStore, parent: OutboxRecord): Promise<OutboxRecord> {
  if (!parent.followups?.length || !canQueueFollowups(parent)) return parent
  let followupError: string | undefined
  try {
    await queueFollowups(store, parent)
  } catch (error) {
    followupError = error instanceof Error ? error.message : 'The follow-up could not be saved.'
  }
  if (parent.followupError === followupError) return parent
  try {
    return await store.put(
      { ...parent, followupError, followupStatus: followupError ? 'failed' : 'complete' },
      parent.revision,
    )
  } catch (error) {
    if (!(error instanceof OutboxError) || error.status !== 409) throw error
    return (await store.get(parent.id)) ?? parent
  }
}
