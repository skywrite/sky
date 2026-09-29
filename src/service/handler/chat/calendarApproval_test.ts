import { mkdtemp, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { assert, test } from '#test'
import { calendarApprovalPrompt, recoverCalendarApprovals, restoreAnsweredApprovals } from './calendarApproval.ts'
import { CALENDAR_FIELDS, calendarApprovalTestHost } from './calendarApprovalTestHelpers.ts'
import { createChatRoutes, type ToolRun, type ChatSessionFactory } from './mod.ts'

test('calendar edits preserve immutable originals and refuse changed availability or sent drafts', async () => {
  const root = await mkdtemp('/tmp/sky-calendar-approval-')
  try {
    const host = calendarApprovalTestHost(root)
    const prepared = await host.scheduler.prepare({ request: 'Meet Jane.' })
    const prompt = await calendarApprovalPrompt({ send: prepared.draftId }, host.client)
    const original = prompt.calendar[0]!
    const edit = {
      id: original.id,
      fields: { ...original.fields, title: 'Atlas revised', time: '16:00' },
      reviewKey: original.reviewKey,
    }
    edit.reviewKey = (await host.scheduler.preview(edit.fields)).reviewKey
    const revised = await prompt.revise(prompt.calendar, [edit])
    assert({
      given: 'explicit edits to a prepared invitation',
      should: 'save a new draft with exact fields while preserving the original and sending nothing',
      actual: [
        revised.calendar[0]!.id !== original.id,
        revised.calendar[0]!.fields,
        (await host.client.approval(original.id, 'schedule')).draft?.fields,
        host.sent,
      ],
      expected: [true, edit.fields, CALENDAR_FIELDS, []],
    })
    host.setWarning('A calendar could not be checked.')
    let stale = ''
    try {
      await prompt.revise(prompt.calendar, [edit])
    } catch (error) {
      stale = String(error)
    }
    assert({
      given: 'availability changed since the editor displayed it',
      should: 'require another review without sending',
      actual: [stale.includes('availability changed'), host.sent.length],
      expected: [true, 0],
    })
    host.setWarning('')
    await host.client.wait(await host.scheduler.send(revised.calendar[0]!.id))
    let sentError = ''
    try {
      await prompt.revise(revised.calendar, [{ ...edit, id: revised.calendar[0]!.id }])
    } catch (error) {
      sentError = String(error)
    }
    assert({
      given: 'a draft that already created its event',
      should: 'keep its receipt and prevent turning it into another invitation',
      actual: [sentError.includes('already being created'), host.sent],
      expected: [true, [edit.fields]],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('chat calendar review pins approval to the latest saved revision and ignores arbitrary tool arguments', async () => {
  const root = await mkdtemp('/tmp/sky-calendar-chat-')
  const host = calendarApprovalTestHost(root)
  const app = createChatRoutes(host.chat)
  const post = (url: string, data: unknown) =>
    app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  let body: Promise<string> | undefined
  try {
    body = (
      await post('/main/messages', { message: 'Schedule Atlas.', profile: 'test', contextTokens: 0, saves: false })
    ).text()
    let pending: any
    for (let attempt = 0; attempt < 100; attempt++) {
      pending = (await (await app.request('/main')).json()).pending?.[0]
      if (pending) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    if (!pending) throw new Error('No calendar approval appeared.')
    const draft = pending.calendar[0]
    const fields = { ...draft.fields, title: 'Atlas reviewed', duration: 45 }
    const reviewKey = (await host.scheduler.preview(fields)).reviewKey
    const reviewing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const review = host.client.review.bind(host.client)
    host.client.review = async (input) => {
      reviewing.resolve()
      await release.promise
      return review(input)
    }
    const revision = post(`/main/approvals/${pending.id}/calendar`, {
      revision: 0,
      drafts: [{ id: draft.id, fields, reviewKey }],
    })
    await reviewing.promise
    const duringEdit = await post(`/main/approvals/${pending.id}`, { approved: true, revision: 0 })
    release.resolve()
    const revised = await revision
    const saved = await revised.json()
    const stale = await post(`/main/approvals/${pending.id}`, { approved: true, revision: 0 })
    const accepted = await post(`/main/approvals/${pending.id}`, {
      approved: true,
      revision: saved.revision,
      input: { send: draft.id },
    })
    await body
    const after = await (await app.request('/main')).json()
    assert({
      given: 'a saved edit, a stale tab, and an approval containing untrusted replacement arguments',
      should: 'refuse the stale approval and execute only the saved reviewed draft once',
      actual: [
        revised.status,
        duringEdit.status,
        saved.revision,
        stale.status,
        accepted.status,
        host.sent,
        after.answered[0].calendar[0].fields,
        after.pending,
      ],
      expected: [200, 409, 1, 409, 200, [fields], fields, []],
    })
    assert({
      given: 'a duplicate approval after sending',
      should: 'leave creation idempotent',
      actual: [(await post(`/main/approvals/${pending.id}`, { approved: true, revision: 1 })).status, host.sent.length],
      expected: [404, 1],
    })
    const loaded = await loadResumeSession(path.join(root, 'main.autosave.md'), { baseDir: root, snapshot: true })
    const recovered = createChatRoutes({
      ...host.chat,
      snapshots: async () => [
        { id: 'main', state: loaded.state, answered: restoreAnsweredApprovals(loaded.recovery?.host?.answered) },
      ],
    })
    const restarted = await (await recovered.request('/main')).json()
    assert({
      given: 'a new chat service restored from the actual snapshot on disk',
      should: 'retain the edited card and its original identity without another approval or invitation',
      actual: [
        restarted.answered.length,
        restarted.answered[0]?.id,
        restarted.answered[0]?.calendar[0]?.fields,
        restarted.pending,
        host.sent.length,
      ],
      expected: [1, pending.id, fields, [], 1],
    })
  } finally {
    await post('/main/stop', {})
    await body
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy chat recovery reconstructs failed cards from executed draft IDs without reviving unsent drafts', async () => {
  const root = await mkdtemp('/tmp/sky-calendar-legacy-card-')
  try {
    const host = calendarApprovalTestHost(root)
    const original = await host.scheduler.prepare({ request: 'Meet Jane.' })
    const fields = { ...CALENDAR_FIELDS, title: 'Atlas launch review', time: '16:15', duration: 45 }
    const edited = await host.scheduler.review({ fields })
    host.setFailure('before_save')
    await host.client.wait(await host.scheduler.send(edited.draftId!))
    const runs: ToolRun[] = [edited, original, edited].map((draft, index) => ({
      tool: 'calendar_schedule',
      callId: `calendar-${index}`,
      at: 1,
      started: 0,
      lines: [],
      status: 'error',
      input: { send: draft.draftId },
      output: { success: false, error: 'Calendar sign-in required.' },
    }))
    const recovered = await recoverCalendarApprovals(runs, host.client, [])
    const repeated = await recoverCalendarApprovals(runs, host.client, recovered)
    const app = createChatRoutes({
      ...host.chat,
      snapshots: async () => [
        {
          id: 'legacy',
          runs,
          state: {
            conversation: [
              { role: 'user', content: 'Schedule Atlas.' },
              { role: 'assistant', content: 'Calendar sign-in required.' },
            ],
            universePaths: [],
            queries: [],
            lastTurn: 1,
            contextLog: [],
          },
        },
      ],
    })
    const restored = await (await app.request('/legacy')).json()
    const again = await (await app.request('/legacy')).json()
    assert({
      given: 'a legacy snapshot containing a failed edited send, an unsent stale ID, and a repeated receipt read',
      should: 'restore one actionable saved card from the durable job without replaying an invitation',
      actual: [
        recovered.length,
        recovered[0]?.calendar?.[0]?.fields,
        recovered[0]?.calendar?.[0]?.job?.retryable,
        repeated,
        restored.answered.length,
        again.answered.length,
        restored.answered[0]?.calendar[0]?.fields,
        host.sent.length,
      ],
      expected: [1, fields, true, [], 1, 1, fields, 0],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recovered unsupported batches never reach the approval card in a later turn', async () => {
  const root = await mkdtemp('/tmp/sky-calendar-recovered-')
  try {
    const host = calendarApprovalTestHost(root)
    const drafts = await Promise.all(
      Array.from({ length: 12 }, () => host.scheduler.review({ fields: CALENDAR_FIELDS })),
    )
    const ids = drafts.map((draft) => draft.draftId!)
    host.setDraftIds(ids)
    const runs: ToolRun[] = [
      {
        tool: 'calendar_schedule',
        at: 1,
        started: 1000,
        status: 'success',
        lines: [],
        output: { status: 'unsupported' },
      },
      ...ids.map((id) => ({
        tool: 'calendar_schedule',
        at: 1,
        started: 2000,
        status: 'success' as const,
        lines: [],
        output: { status: 'ready', draftId: id },
      })),
    ]
    host.chat.snapshots = async () => [
      {
        id: 'recovered',
        runs: JSON.parse(JSON.stringify(runs)),
        state: {
          conversation: [
            { role: 'user', content: 'Schedule a weekly Atlas review.' },
            { role: 'assistant', content: 'Scheduling was stopped.' },
          ],
          universePaths: [],
          queries: [],
          lastTurn: 1,
          contextLog: [],
        },
      },
    ]
    const app = createChatRoutes(host.chat)
    const response = await app.request('/recovered/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Continue.', profile: 'test', contextTokens: 0, saves: false }),
    })
    const stream = await response.text()
    const after = await (await app.request('/recovered')).json()
    assert({
      given: 'a restarted service and another message whose model reuses the whole rejected batch',
      should: 'deny before approval, expose no send button, and create no events',
      actual: [
        response.status,
        stream.includes('event: approval-request'),
        after.pending,
        host.sent,
        after.turns.length,
      ],
      expected: [200, false, [], [], 4],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unsupported result arriving after an approval blocks both edits and acceptance', async () => {
  const root = await mkdtemp('/tmp/sky-calendar-late-rejection-')
  const host = calendarApprovalTestHost(root)
  const factory = host.chat.createSession
  let report!: Parameters<ChatSessionFactory>[1]
  host.chat.createSession = async (...args) => {
    report = args[1]
    return factory(...args)
  }
  const app = createChatRoutes(host.chat)
  const post = (url: string, value: unknown) =>
    app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })
  const response = await post('/late/messages', {
    message: 'Schedule Atlas.',
    profile: 'test',
    contextTokens: 0,
    saves: false,
  })
  const stream = response.text()
  try {
    let pending
    for (let i = 0; i < 100; i++) {
      pending = (await (await app.request('/late')).json()).pending[0]
      if (pending) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    if (!pending) throw new Error('Missing test approval')
    const draft = pending.calendar[0]
    report({
      type: 'tool-execution-end',
      toolCallId: 'prepared',
      toolName: 'calendar_schedule',
      finished: 2000,
      output: { status: 'ready', draftId: draft.id },
    })
    const reviewing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const review = host.client.review.bind(host.client)
    host.client.review = async (input) => {
      reviewing.resolve()
      await release.promise
      return review(input)
    }
    const changing = post(`/late/approvals/${pending.id}/calendar`, {
      revision: 0,
      drafts: [{ id: draft.id, fields: { ...draft.fields, title: 'Atlas revised' }, reviewKey: draft.reviewKey }],
    })
    await reviewing.promise
    report({
      type: 'tool-execution-end',
      toolCallId: 'unsupported',
      toolName: 'calendar_schedule',
      finished: 3000,
      output: { status: 'unsupported' },
    })
    release.resolve()
    const edit = await changing
    const retry = await post(`/late/approvals/${pending.id}/calendar`, { revision: 0, drafts: [] })
    const accept = await post(`/late/approvals/${pending.id}`, { approved: true, revision: 0 })
    await stream
    const after = await (await app.request('/late')).json()
    assert({
      given: 'an unsupported result arriving while an existing approval saves an edit',
      should: 'refuse editing into new IDs and resolve acceptance as denied, with no calendar writes',
      actual: [
        edit.status,
        retry.status,
        accept.status,
        after.answered[0].approved,
        after.answered[0].calendar[0].id,
        after.pending,
        host.sent,
      ],
      expected: [409, 409, 409, false, draft.id, [], []],
    })
  } finally {
    await post('/late/stop', {})
    await stream
    await rm(root, { recursive: true, force: true })
  }
})
