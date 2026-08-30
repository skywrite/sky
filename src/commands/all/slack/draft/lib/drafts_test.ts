import { assert, test } from '#test'
import { createDraft, deleteDraft, draftLink, isScheduled, listActiveDrafts, slackTs } from './drafts.ts'

const WORKSPACE = 'https://atlas.enterprise.slack.com'

type Reply = { code?: number; stdout?: string; stderr?: string }

/** A fake agent-slack that records its argv and answers with one canned reply. */
const fakeRun = (reply: Reply) => {
  const calls: string[][] = []
  const run = async (args: string[]) => {
    calls.push(args)
    const code = reply.code ?? 0
    return { code, success: code === 0, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' }
  }
  return { run, calls }
}

test('listActiveDrafts: parses the CLI page with shape defaults', async () => {
  const { run, calls } = fakeRun({
    stdout: JSON.stringify({
      ok: true,
      count: 3,
      drafts: [
        {
          id: 'Dr1',
          text: 'hello <@U0JANE01>',
          destinations: [{ channel_id: 'C0ATLAS1', thread_ts: '1699999999.000100', channel_name: 'atlas' }],
          last_updated_ts: '1700000000.000100',
          date_created: 1700000000,
          date_scheduled: 1700003600,
          file_ids: ['F1'],
        },
        { id: 'Dr2', destinations: [{ channel_id: 'D0JANE01' }, { thread_ts: 'no-channel' }] },
        { text: 'no id' },
      ],
    }),
  })
  const page = await listActiveDrafts(WORKSPACE, run)
  assert({
    given: 'a full, a sparse, and an id-less draft',
    should: 'keep the two with ids, defaults filled in',
    actual: page,
    expected: {
      hasMore: false,
      drafts: [
        {
          id: 'Dr1',
          text: 'hello <@U0JANE01>',
          last_updated_ts: '1700000000.000100',
          date_scheduled: 1700003600,
          file_ids: ['F1'],
          destinations: [{ channel_id: 'C0ATLAS1', thread_ts: '1699999999.000100', channel_name: 'atlas' }],
        },
        {
          id: 'Dr2',
          text: '',
          last_updated_ts: '',
          date_scheduled: 0,
          file_ids: [],
          destinations: [{ channel_id: 'D0JANE01', thread_ts: undefined, channel_name: undefined }],
        },
      ],
    },
  })
  assert({
    given: 'the spawn',
    should: 'ask agent-slack for the workspace page at the cap',
    actual: calls,
    expected: [['message', 'draft', 'list', '--workspace', WORKSPACE, '--limit', '100']],
  })
})

test('listActiveDrafts: a full page may be deeper', async () => {
  const drafts = Array.from({ length: 100 }, (_, i) => ({ id: `Dr${i}`, destinations: [] }))
  const page = await listActiveDrafts(WORKSPACE, fakeRun({ stdout: JSON.stringify({ ok: true, drafts }) }).run)
  assert({ given: '100 drafts', should: 'flag more', actual: 'hasMore' in page && page.hasMore, expected: true })
})

test('listActiveDrafts: names the fix on failure', async () => {
  const expired = await listActiveDrafts(WORKSPACE, fakeRun({ code: 1, stderr: 'invalid_auth' }).run)
  assert({
    given: 'expired credentials',
    should: 'point at sky slack:auth',
    actual: expired,
    expected: {
      error: 'agent-slack message draft list failed: invalid_auth — credentials expired, run `sky slack:auth`',
    },
  })
  const restricted = await listActiveDrafts(WORKSPACE, fakeRun({ code: 1, stderr: 'team_is_restricted' }).run)
  assert({
    given: 'a team-level workspace',
    should: 'explain the enterprise URL',
    actual: 'error' in restricted && restricted.error.includes('enterprise URL'),
    expected: true,
  })
  const junk = await listActiveDrafts(WORKSPACE, fakeRun({ stdout: 'not json' }).run)
  assert({
    given: 'unparseable output',
    should: 'say so',
    actual: junk,
    expected: { error: 'Unparseable agent-slack draft list output: not json' },
  })
})

test('createDraft: options first, then -- target text; thread when asked', async () => {
  const { run, calls } = fakeRun({
    stdout: JSON.stringify({
      ok: true,
      draft: {
        id: 'Dr9',
        text: '- one',
        destinations: [{ channel_id: 'C0ATLAS1', thread_ts: '1699999999.000100' }],
        last_updated_ts: '1700000001.000000',
      },
    }),
  })
  const thread = await createDraft(WORKSPACE, { target: 'C0ATLAS1', threadTs: '1699999999.000100', text: '- one' }, run)
  const composer = await createDraft(WORKSPACE, { target: '#atlas', text: 'hi' }, run)
  assert({
    given: 'a thread reply whose body starts with a dash, and a composer draft',
    should: 'spawn create with options before -- so the body is never a flag',
    actual: calls,
    expected: [
      [
        'message',
        'draft',
        'create',
        '--workspace',
        WORKSPACE,
        '--thread-ts',
        '1699999999.000100',
        '--',
        'C0ATLAS1',
        '- one',
      ],
      ['message', 'draft', 'create', '--workspace', WORKSPACE, '--', '#atlas', 'hi'],
    ],
  })
  assert({
    given: 'the echoed record',
    should: 'come back parsed',
    actual: [thread.ok && thread.draft?.id, thread.ok && thread.draft?.destinations[0]?.thread_ts, composer.ok],
    expected: ['Dr9', '1699999999.000100', true],
  })
  assert({
    given: 'a failure',
    should: 'carry the CLI error',
    actual: await createDraft(
      WORKSPACE,
      { target: '#nope', text: 'hi' },
      fakeRun({ code: 1, stderr: 'channel_not_found' }).run,
    ),
    expected: { ok: false, error: 'agent-slack message draft create failed: channel_not_found' },
  })
})

test('deleteDraft: passes the edit ts so the CLI needs no re-list', async () => {
  const { run, calls } = fakeRun({ stdout: JSON.stringify({ ok: true, draft_id: 'Dr1' }) })
  const done = await deleteDraft(WORKSPACE, { id: 'Dr1', last_updated_ts: '1700000000.000100' }, run)
  await deleteDraft(WORKSPACE, { id: 'Dr2', last_updated_ts: '' }, run)
  assert({
    given: 'drafts with and without an edit ts',
    should: 'pass --last-updated-ts only when known',
    actual: [done, calls],
    expected: [
      { ok: true },
      [
        ['message', 'draft', 'delete', 'Dr1', '--workspace', WORKSPACE, '--last-updated-ts', '1700000000.000100'],
        ['message', 'draft', 'delete', 'Dr2', '--workspace', WORKSPACE],
      ],
    ],
  })
  assert({
    given: 'a failure',
    should: 'carry the CLI error',
    actual: await deleteDraft(
      WORKSPACE,
      { id: 'Dr1', last_updated_ts: '1' },
      fakeRun({ code: 1, stderr: 'draft_not_found' }).run,
    ),
    expected: { ok: false, error: 'agent-slack message draft delete failed: draft_not_found' },
  })
})

test('draftLink, isScheduled, slackTs', () => {
  assert({
    given: 'a thread destination',
    should: 'link the thread root',
    actual: draftLink(WORKSPACE, { channel_id: 'C0ATLAS1', thread_ts: '1699999999.000100' }),
    expected: `${WORKSPACE}/archives/C0ATLAS1/p1699999999000100`,
  })
  assert({
    given: 'a conversation destination',
    should: 'link the conversation',
    actual: draftLink(WORKSPACE, { channel_id: 'D0ATLAS1' }),
    expected: `${WORKSPACE}/archives/D0ATLAS1`,
  })
  assert({
    given: 'no destination',
    should: 'have no link',
    actual: draftLink(WORKSPACE, undefined),
    expected: undefined,
  })
  const draft = { id: 'Dr1', text: '', last_updated_ts: '1', date_scheduled: 0, file_ids: [], destinations: [] }
  assert({ given: 'no date', should: 'not be scheduled', actual: isScheduled(draft), expected: false })
  assert({
    given: 'a date',
    should: 'be scheduled',
    actual: isScheduled({ ...draft, date_scheduled: 1700000000 }),
    expected: true,
  })
  assert({
    given: 'milliseconds',
    should: 'become a six-digit Slack ts',
    actual: slackTs(1700000000042),
    expected: '1700000000.042000',
  })
})
