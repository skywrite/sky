import type { AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { assert, test } from '#test'
import { type ConversationReader, readConversation } from './feed.ts'

const message = (ts: string, extra: Partial<AgentSlackMessage> = {}): AgentSlackMessage => ({
  channel_id: 'D0JANE',
  ts,
  ...extra,
})

/** The cursor: the newest message landed so far */
const CURSOR = '1759900000.000100'

function reader(threads: Record<string, AgentSlackMessage[] | Error>): ConversationReader & { reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    history: async (oldest) => {
      reads.push(`history ${oldest}`)
      return [
        message('1759900100.000100', { thread_ts: '1759900100.000100', latest_reply: '1759900200.000100' }),
        message('1759900300.000100'),
      ]
    },
    thread: async (root) => {
      reads.push(`thread ${root}`)
      const thread = threads[root]
      if (thread instanceof Error) throw thread
      return thread ?? []
    },
  }
}

test('a conversation read brings the new replies under older messages when Slack names their thread', async () => {
  const slack = reader({
    '1759900100.000100': [message('1759900100.000100'), message('1759900200.000100')],
    // A thread whose root landed on an earlier pass: one reply landed with it, one is new
    '1759800000.000100': [message('1759800000.000100'), message('1759850000.000100'), message('1759900400.000100')],
  })
  const messages = await readConversation(slack, CURSOR, ['1759800000.000100'])
  assert({
    given: 'new messages, a new root that gained a reply, and a named thread under a root older than the cursor',
    should: 'read each thread once and keep only what is newer than the cursor, oldest first',
    actual: [slack.reads, messages.map((m) => m.ts)],
    expected: [
      [`history ${CURSOR}`, 'thread 1759900100.000100', 'thread 1759800000.000100'],
      ['1759900100.000100', '1759900200.000100', '1759900300.000100', '1759900400.000100'],
    ],
  })
})

test('a named thread Slack no longer has is skipped; any other failure fails the read', async () => {
  const gone = await readConversation(
    reader({
      '1759900100.000100': [message('1759900200.000100')],
      '1759800000.000100': new Error('agent-slack message list --thread-ts failed: thread_not_found'),
    }),
    CURSOR,
    ['1759800000.000100'],
  )
  assert({
    given: 'a named thread whose root was deleted',
    should: 'land the rest of the conversation',
    actual: gone.map((m) => m.ts),
    expected: ['1759900100.000100', '1759900200.000100', '1759900300.000100'],
  })
  const limited = await readConversation(
    reader({ '1759800000.000100': new Error('agent-slack message list --thread-ts failed: ratelimited') }),
    CURSOR,
    ['1759800000.000100'],
  ).catch((error: Error) => error.message)
  assert({
    given: 'a named thread that fails for another reason',
    should: 'fail, so the landing tries the conversation again',
    actual: limited,
    expected: 'agent-slack message list --thread-ts failed: ratelimited',
  })
})
