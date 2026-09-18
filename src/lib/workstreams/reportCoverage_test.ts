import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import type { DispatchReportInput, ReportDeliveryGrant, ReportDeliveryRecord } from './delivery.ts'
import { runWorkstream, type RunWorkstreamOptions } from './runner.ts'
import { WorkstreamStore } from './store.ts'
import { ReportingSchema, SkySchema, type WorkstreamSource } from './types.ts'

const NOW = '2025-03-15 09:00'

async function fixture(run: (input: { root: string; store: WorkstreamStore }) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-report-coverage-'))
  try {
    await run({ root, store: new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root) })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function observedDelivery(observed: DispatchReportInput[]): NonNullable<RunWorkstreamOptions['reportDelivery']> {
  return {
    grant: async (workstreamId, reportingId): Promise<ReportDeliveryGrant> => ({
      workstreamId,
      reportingId,
      mode: 'review',
      target: { medium: 'email', account: 'owner@example.com', to: ['jane@example.com'] },
      maxPerDay: 1,
      revision: 'permission',
      scopeVersion: 'policy',
      scopeCurrent: true,
      updated: NOW,
    }),
    // This test double observes the runner's deterministic coverage checks independently of provider I/O.
    sourceVersions: async (work, policy) =>
      Object.fromEntries(
        work.sources
          .filter((source) => policy.permittedSourceIds.includes(source.id))
          .map((source) => [source.id, 'snapshot']),
      ),
    reconcilePending: async () => [],
    dispatch: async (input): Promise<ReportDeliveryRecord> => {
      observed.push(input)
      const blockers = input.missingInputs ?? []
      return {
        id: input.artifactId,
        workstreamId: input.workstreamId,
        reportingId: input.reportingId,
        artifactId: input.artifactId,
        activityId: 'report-activity',
        status: 'review',
        created: NOW,
        updated: NOW,
        title: 'Atlas update',
        body: 'Prepared report',
        artifactVersion: 'artifact',
        policyVersion: 'policy',
        sourceVersions: input.expectedSourceVersions ?? {},
        attachments: [],
        blockers,
        revision: 'delivery',
      }
    },
  }
}

test('an audience source after the general twenty-source window still reaches the reporting model', async () =>
  fixture(async ({ root, store }) => {
    const sources: WorkstreamSource[] = []
    for (let index = 0; index < 22; index++) {
      const id = `source-${index}`
      await writeFile(path.join(root, `${id}.md`), `Atlas context ${index}.`)
      sources.push({ id, path: `${id}.md`, label: id, sensitive: false })
    }
    let work = await store.create(
      {
        title: 'Atlas launch',
        sources,
        reporting: [
          ReportingSchema.parse({
            id: 'team',
            audience: 'Launch team',
            medium: 'email',
            permittedSourceIds: ['source-21'],
          }),
        ],
      },
      NOW,
    )
    work = await store.configureSky(work.id, SkySchema.parse({ mode: 'drive' }), work.revision)
    const dispatched: DispatchReportInput[] = []
    let supplied: { id: string; content: string }[] = []
    const result = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      trigger: 'scheduled',
      reportDelivery: observedDelivery(dispatched),
      report: async (context) => {
        supplied = context.sources as typeof supplied
        return { title: 'Atlas update', body: 'Atlas context 21.', missingInputs: [] }
      },
    })
    assert({
      given: 'an audience selecting only the twenty-second general workstream source',
      should:
        'apply audience selection before context limits and supply that actual source without missing-context blockers',
      actual: [result.status, supplied.map((source) => source.id), supplied[0]?.content, dispatched[0]?.missingInputs],
      expected: ['completed', ['source-21'], 'Atlas context 21.', []],
    })
  }))

test('report source truncation and unavailable content create deterministic factual blockers', async () =>
  fixture(async ({ root, store }) => {
    await writeFile(path.join(root, 'long.md'), 'Atlas context. '.repeat(1500))
    let work = await store.create(
      {
        title: 'Atlas launch',
        sources: [
          { id: 'long', path: 'long.md', label: 'Long brief', sensitive: false },
          { id: 'missing', path: 'missing.md', label: 'Missing brief', sensitive: false },
        ],
        reporting: [
          ReportingSchema.parse({
            id: 'team',
            audience: 'Launch team',
            medium: 'email',
            permittedSourceIds: ['long', 'missing'],
          }),
        ],
      },
      NOW,
    )
    work = await store.configureSky(work.id, SkySchema.parse({ mode: 'drive' }), work.revision)
    const dispatched: DispatchReportInput[] = []
    const result = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      trigger: 'scheduled',
      reportDelivery: observedDelivery(dispatched),
      report: async () => ({
        title: 'Atlas update',
        body: 'The model omitted its own missing-input warnings.',
        missingInputs: [],
      }),
    })
    const artifact = await store.readArtifact(work.id, result.artifactIds[0])
    assert({
      given: 'a model that claims no missing inputs despite truncated and unavailable selected sources',
      should: 'persist independent missing-context blockers in the artifact and pass them to delivery',
      actual: [
        result.status,
        dispatched[0]?.missingInputs?.some((value) => value.includes('Long brief') && value.includes('incomplete')),
        dispatched[0]?.missingInputs?.some((value) => value.includes('Missing brief') && value.includes('unavailable')),
        artifact.content.includes('Inputs still needed'),
      ],
      expected: ['completed', true, true, true],
    })
  }))

test('more than twenty audience-selected sources retain omitted-source blockers', async () =>
  fixture(async ({ root, store }) => {
    const sources: WorkstreamSource[] = []
    for (let index = 0; index < 21; index++) {
      const id = `source-${index}`
      await writeFile(path.join(root, `${id}.md`), `Atlas source ${index}.`)
      sources.push({ id, path: `${id}.md`, label: id, sensitive: false })
    }
    let work = await store.create(
      {
        title: 'Atlas launch',
        sources,
        reporting: [
          ReportingSchema.parse({
            id: 'team',
            audience: 'Launch team',
            medium: 'email',
            permittedSourceIds: sources.map((source) => source.id),
          }),
        ],
      },
      NOW,
    )
    work = await store.configureSky(work.id, SkySchema.parse({ mode: 'drive' }), work.revision)
    const dispatched: DispatchReportInput[] = []
    const result = await runWorkstream({
      store,
      id: work.id,
      now: NOW,
      trigger: 'scheduled',
      reportDelivery: observedDelivery(dispatched),
      report: async () => ({ title: 'Atlas update', body: 'Prepared from the supplied context.', missingInputs: [] }),
    })
    assert({
      given: 'an audience selecting more sources than one reporting model can receive',
      should: 'retain an explicit blocker for the omitted selected source',
      actual: [
        result.status,
        dispatched[0]?.missingInputs?.some((value) => value.includes('source-20') && value.includes('context limit')),
      ],
      expected: ['completed', true],
    })
  }))
