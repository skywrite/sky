import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { hash } from '#lib/outbox/files.ts'
import { WorkstreamStore } from '#lib/workstreams/store.ts'
import { ActivitySchema, type WorkstreamRecord } from '#lib/workstreams/types.ts'
import { assert, test } from '#test'
import { createWorkstreamRoutes } from './mod.ts'

const NOW = '2025-03-15 09:00'
const CONTENT = 'The pilot team can support the invited cohort.'
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-decision-policy-route-'))
  const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root, () =>
    NOW.slice(0, 10),
  )
  await writeFile(path.join(root, 'feedback.md'), CONTENT)
  const work = await store.create(
    {
      title: 'Atlas pilot',
      sources: [
        { id: 'brief', path: 'feedback.md', label: 'Pilot input', sensitive: false, stakeholderIds: ['reviewer'] },
      ],
      stakeholders: [{ id: 'reviewer', name: 'Jane Doe', role: 'Contributor', contact: '' }],
      activities: [
        ActivitySchema.parse({ id: 'choose', title: 'Choose the pilot cohort', kind: 'decision', state: 'proposed' }),
      ],
    },
    NOW,
  )
  let setupCalls = 0
  const app = createWorkstreamRoutes({
    store,
    now: () => NOW,
    today: () => NOW.slice(0, 10),
    draft: async () => ({}),
    automation: async () => null,
    setup: async () => {
      setupCalls++
      return {}
    },
    run: async (id) => ({
      id: 'run',
      workstreamId: id,
      status: 'nothing',
      trigger: 'manual',
      started: NOW,
      summary: '',
      artifactIds: [],
    }),
    planDay: async (id) => (await store.get(id))!,
  })
  const request = (data: unknown) =>
    app.request(`/${work.id}/activities/choose/decision-policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  const payload = (revision = work.revision) => ({
    revision,
    policy: {
      mode: 'delegate',
      instruction: 'Choose the supported cohort from the approved options.',
      activityTitle: 'A forged title must not survive.',
      options: [{ id: 'invited', label: 'Invited cohort' }],
      requiredSourceIds: ['brief'],
      requiredStakeholderIds: ['reviewer'],
      requiredAssumptionIds: ['capacity'],
    },
    assumptions: [
      {
        id: 'capacity',
        statement: 'The team has capacity.',
        status: 'confirmed',
        sourceIds: ['brief'],
        sourceVersions: { brief: 'forged-version' },
        confirmedBy: 'forged-agent',
      },
    ],
  })
  return {
    root,
    store,
    work,
    request,
    payload,
    setupCalls: () => setupCalls,
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

test('decision policy route atomically assigns Sky and captures owner-confirmed source versions', async () => {
  const f = await fixture()
  try {
    const response = await f.request(f.payload())
    const saved = (await response.json()) as WorkstreamRecord
    const grant = await f.store.getGrant(f.work.id)
    const decision = saved.activities[0]
    assert({
      given: 'an explicit per-decision delegation with a confirmed assumption',
      should: 'save assignment and exact external authority together using real source revision and owner attribution',
      actual: [
        response.status,
        decision.executor,
        decision.state,
        decision.decisionAssumptions?.[0].confirmedBy,
        decision.decisionAssumptions?.[0].sourceVersions.brief,
        grant.decisionPolicies.choose.mode,
        grant.decisionPolicies.choose.activityTitle,
        grant.mode,
        f.setupCalls(),
      ],
      expected: [200, 'sky', 'ready', 'owner', hash(CONTENT), 'delegate', 'Choose the pilot cohort', 'off', 0],
    })
  } finally {
    await f.clean()
  }
})

test('stale decision delegation cannot overwrite a newer human edit or change assignment', async () => {
  const f = await fixture()
  try {
    const edited = await f.store.put({ ...f.work, notes: 'The owner is reconsidering the scope.' }, f.work.revision)
    const beforeGrant = await f.store.getGrant(f.work.id)
    const response = await f.request(f.payload())
    const after = (await f.store.get(f.work.id))!
    const afterGrant = await f.store.getGrant(f.work.id)
    assert({
      given: 'a delegation form based on the prior work revision',
      should: 'reject it without changing the newer work or external permissions',
      actual: [
        response.status,
        after.revision === edited.revision,
        after.activities[0].executor,
        beforeGrant.revision === afterGrant.revision,
        Object.keys(afterGrant.decisionPolicies).length,
      ],
      expected: [409, true, 'human', true, 0],
    })
  } finally {
    await f.clean()
  }
})

test('a missing assumption source leaves both the activity and decision grant unchanged', async () => {
  const f = await fixture()
  try {
    const beforeGrant = await f.store.getGrant(f.work.id)
    await rm(path.join(f.root, 'feedback.md'))
    const response = await f.request(f.payload())
    const after = (await f.store.get(f.work.id))!
    const afterGrant = await f.store.getGrant(f.work.id)
    assert({
      given: 'a confirmation whose selected source no longer exists',
      should: 'fail before assignment, assumption or permission writes',
      actual: [
        response.status,
        after.revision === f.work.revision,
        after.activities[0].executor,
        after.activities[0].decisionAssumptions?.length ?? 0,
        afterGrant.revision === beforeGrant.revision,
      ],
      expected: [400, true, 'human', 0, true],
    })
  } finally {
    await f.clean()
  }
})

test('revoking a decision delegation returns assignment to the human and preserves evidence history', async () => {
  const f = await fixture()
  try {
    const delegated = (await (await f.request(f.payload())).json()) as WorkstreamRecord
    const response = await f.request({
      revision: delegated.revision,
      policy: { mode: 'human' },
      assumptions: delegated.activities[0].decisionAssumptions,
    })
    const saved = (await response.json()) as WorkstreamRecord
    const grant = await f.store.getGrant(f.work.id)
    assert({
      given: 'the owner withdraws one decision responsibility',
      should: 'return the decision to human control without discarding the confirmed assumption',
      actual: [
        response.status,
        saved.activities[0].executor,
        grant.decisionPolicies.choose.mode,
        saved.activities[0].decisionAssumptions?.[0].sourceVersions.brief,
      ],
      expected: [200, 'human', 'human', hash(CONTENT)],
    })
  } finally {
    await f.clean()
  }
})
