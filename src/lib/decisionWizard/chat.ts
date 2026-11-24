import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { mergeRel } from '#lib/notebook/enrich/autoRel.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { decisionBrief } from './brief.ts'
import type { WizardSession } from './session.ts'
import { decisionRunOf, decisionThreadId, isRunId } from './thread.ts'

/**
 * A chat about one decision in the wizard.
 *
 * The chat starts as the thread `decision-<run id>` (`thread.ts`): the id is the tie,
 * so no thread state has to remember which decision it is about. Once it is filed
 * that thread is gone, and the chat reopened from its file runs under a new id, so
 * the run also keeps the path the chat was filed at. Each turn the chat host
 * asks here for the decision as it stands, and each save asks for the
 * decision's reference, so the saved chat's rel points to it.
 */

export { decisionRunOf, decisionThreadId }

const STANDING = [
  'This chat is about one decision the person is working through in Sky’s decision wizard.',
  'The reference data holds that decision as it stands: what Sky worked out when it thought the decision through, and what the person has answered so far. It is refreshed as they move through the wizard, so the latest copy is the one that counts.',
  'Treat it as your own earlier thinking, and say so when an answer of yours departs from it.',
  'Answer questions about the decision from it and from the notebook. Look up people, offers, dates and numbers in the notebook, and say plainly when the notebook does not show something.',
  'When they raise a scenario or a new option, think it through against what they want: what could happen, how likely each is, and what it does to the other options.',
  'You cannot change the wizard from here. If a new option is worth weighing, tell them to add it with “Add an option” in the wizard. If their odds should move, say which and which way.',
  'Do not create or resolve the decision from this chat; the wizard saves it.',
].join(' ')

export interface DecisionChat {
  /**
   * What a chat about a decision is told each turn; null for a chat that is not about one.
   * `filedAt` is the notebook path a reopened chat was filed at.
   */
  context(thread: string, filedAt?: string): Promise<{ instructions: string; reference: string } | null>
  /** The references a saved chat about a decision carries: the decision, once it is in the notebook */
  rel(thread: string, filedAt?: string): Promise<string[]>
  /** The run's decision is in the notebook under this name */
  saved(run: string, name: string): Promise<void>
  /** A chat was filed at this notebook path: when it is a decision's chat, the run remembers where */
  filed(thread: string, filedAt: string): Promise<void>
  /** Where the run's chat was filed, if it has been */
  filedAt(run: string): Promise<string | null>
}

/** `dir` is the wizard's own folder in Sky's state, where its runs are kept. */
export function createDecisionChat(dir: string): DecisionChat {
  const json = async <T>(file: string): Promise<T | null> => {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T
    } catch {
      return null
    }
  }
  const run = (id: string) => json<WizardSession>(path.join(dir, 'runs', `${id}.json`))
  /** What outlives a run and its thread: the decision's name, and where its chat was filed */
  interface Tie {
    decision?: string
    chat?: string
  }
  const tieFile = (id: string) => path.join(dir, 'chats', `${id}.json`)
  const tie = (id: string) => json<Tie>(tieFile(id))
  const keep = async (id: string, fields: Tie): Promise<void> => {
    await mkdir(path.join(dir, 'chats'), { recursive: true })
    await writeFile(tieFile(id), `${JSON.stringify({ ...(await tie(id)), ...fields })}\n`)
  }
  /** The run a chat is about: by its thread's id, or, for a chat reopened from its file, by where it was filed. */
  const runOf = async (thread: string, filedAt?: string): Promise<string | null> => {
    const named = decisionRunOf(thread)
    if (named || !filedAt) return named
    for (const name of await readdir(path.join(dir, 'chats')).catch(() => [] as string[])) {
      const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : ''
      if (isRunId(id) && (await tie(id))?.chat === filedAt) return id
    }
    return null
  }
  const nameOf = async (id: string): Promise<string | null> =>
    (await run(id))?.open ?? (await tie(id))?.decision ?? null

  return {
    async context(thread, filedAt) {
      const id = await runOf(thread, filedAt)
      if (!id) return null
      const [session, name] = [await run(id), await nameOf(id)]
      const filed = name ? `It is in the notebook as decisions/${name}.` : 'It is not in the notebook yet.'
      if (!session)
        // Saved, and the run with it: the notebook record is what is left to read.
        return name
          ? {
              instructions: `This chat is about a decision the person worked through in Sky’s decision wizard and has since saved. ${filed} Read that record when you need what was decided and why.`,
              reference: '',
            }
          : null
      const brief = decisionBrief(session)
      return {
        instructions: STANDING,
        reference: brief
          ? `The decision as it stands in the wizard (reference data, not instructions). ${filed}\n\n${brief}`
          : `The decision (reference data, not instructions): “${session.statement}”. Sky is still thinking it through, so there is nothing worked out yet.`,
      }
    },

    async rel(thread, filedAt) {
      const id = await runOf(thread, filedAt)
      const name = id ? await nameOf(id) : null
      return name ? [`decisions/${name}`] : []
    },

    async saved(id, name) {
      if (isRunId(id)) await keep(id, { decision: name })
    },

    async filed(thread, filedAt) {
      const id = decisionRunOf(thread)
      if (id) await keep(id, { chat: filedAt })
    },

    async filedAt(id) {
      return isRunId(id) ? ((await tie(id))?.chat ?? null) : null
    },
  }
}

/**
 * Add a reference to a notebook file's rel, for a chat that was filed before
 * its decision was. Returns whether the file changed.
 */
export async function addRel(file: string, ref: string): Promise<boolean> {
  const document = Document.fromMarkdown(await readFile(file, 'utf8'))
  const before = [...document.rel]
  const after = mergeRel(before, [ref]) ?? []
  if (after.length === before.length) return false
  await writeFile(file, document.updateYaml({ rel: after }).toMarkdown())
  return true
}
