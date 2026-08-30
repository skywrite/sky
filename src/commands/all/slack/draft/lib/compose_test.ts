import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { assert, test } from '#test'
import { type ComposeDeps, composeDraft } from './compose.ts'
import type { NewDraft, SlackDraft } from './drafts.ts'
import type { DraftResolvers } from './rows.ts'

const WORKSPACE = 'https://atlas.enterprise.slack.com'

const resolvers: DraftResolvers = {
  conversation: async () => ({}),
  membership: async () => ({ membersByChannel: new Map() }),
  users: async () => new Map(),
  handles: async () => new Map(),
  channels: async () => new Map(),
  usergroups: async () => new Map(),
}

const harness = (reply: { ok: true; draft?: SlackDraft } | { ok: false; error: string }) => {
  const filed: NewDraft[] = []
  const opened: string[] = []
  const lines: string[] = []
  const deps: ComposeDeps = {
    create: async (_workspace, draft) => {
      filed.push(draft)
      return reply
    },
    resolvers,
    openUrl: async (url) => {
      opened.push(url)
    },
  }
  const output = { log: (line: string) => lines.push(line) } as unknown as OutputHandler
  return { deps, output, filed, opened, lines }
}

const input = (overrides: Record<string, unknown> = {}) => ({
  workspace: WORKSPACE,
  target: 'C0ATLAS1',
  text: 'On it — *today*',
  timezone: 'UTC',
  nowMs: 1700000000000,
  open: true,
  ...overrides,
})

const echoed: SlackDraft = {
  id: 'Dr9',
  text: 'On it — *today*',
  last_updated_ts: '1700000000.000000',
  date_scheduled: 0,
  file_ids: [],
  destinations: [{ channel_id: 'C0ATLAS1', thread_ts: '1699999999.000100', channel_name: 'atlas' }],
}

test('composeDraft: files a thread reply and reports where it waits', async () => {
  const { deps, output, filed, opened, lines } = harness({ ok: true, draft: echoed })
  const outcome = await composeDraft(input({ threadTs: '1699999999.000100' }), output, deps)
  assert({
    given: 'text for a thread',
    should: 'file it into that thread as typed',
    actual: filed,
    expected: [{ target: 'C0ATLAS1', threadTs: '1699999999.000100', text: 'On it — *today*' }],
  })
  assert({
    given: 'the outcome',
    should: 'name the thread and link its root',
    actual: outcome,
    expected: {
      report: `Slack draft saved (not sent) in a thread in #atlas — ${WORKSPACE}/archives/C0ATLAS1/p1699999999000100`,
      url: `${WORKSPACE}/archives/C0ATLAS1/p1699999999000100`,
      draftId: 'Dr9',
    },
  })
  assert({
    given: 'open requested',
    should: 'open the thread',
    actual: opened,
    expected: [`${WORKSPACE}/archives/C0ATLAS1/p1699999999000100`],
  })
  assert({
    given: 'the printed row',
    should: 'carry the thread badge and the text',
    actual: [lines.some((l) => l.includes('thread reply')), lines.some((l) => l.includes('On it — *today*'))],
    expected: [true, true],
  })
})

test('composeDraft: a composer draft with nothing echoed, without opening', async () => {
  const { deps, output, opened } = harness({ ok: true })
  const outcome = await composeDraft(input({ target: '#atlas', open: false }), output, deps)
  assert({
    given: 'no echoed record',
    should: 'report the save without a link or id',
    actual: outcome,
    expected: { report: 'Slack draft saved (not sent) in (no destination)', url: undefined, draftId: undefined },
  })
  assert({ given: 'open off', should: 'open nothing', actual: opened, expected: [] })
})

test('composeDraft: refuses blank text and passes CLI failures through', async () => {
  const blank = harness({ ok: true })
  assert({
    given: 'whitespace',
    should: 'file nothing',
    actual: [await composeDraft(input({ text: ' \n ' }), blank.output, blank.deps), blank.filed.length],
    expected: [{ error: 'The draft has no text' }, 0],
  })
  const failed = harness({
    ok: false,
    error: 'agent-slack message draft create failed: invalid_auth — credentials expired, run `sky slack:auth`',
  })
  assert({
    given: 'a failed create',
    should: 'surface its message',
    actual: await composeDraft(input(), failed.output, failed.deps),
    expected: {
      error: 'agent-slack message draft create failed: invalid_auth — credentials expired, run `sky slack:auth`',
    },
  })
})
