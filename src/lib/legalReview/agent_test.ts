import { readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { assert, test } from '#test'
import { LegalReviewer } from './agent.ts'
import { reviewFixture, REVIEW_CONTEXT, scriptedAnalysis } from './testHelpers.ts'
import { activeDocuments, openFindings } from './types.ts'

test('agreement review retains five originals, shares context and compares later documents', async () => {
  const calls: { count: number; context: string; nativePdf: boolean }[] = []
  const fixture = await reviewFixture(async (input) => {
    calls.push({
      count: input.documents.length,
      context: input.context.instructions,
      nativePdf: input.documents.some((doc) => doc.document.kind === 'pdf'),
    })
    return scriptedAnalysis(input)
  })
  try {
    let review = await fixture.reviewer.review({
      sources: fixture.sources.slice(0, 1),
      context: REVIEW_CONTEXT,
      expectedDocuments: 5,
    })
    const firstId = review.findings[0].id
    for (const source of fixture.sources.slice(1))
      review = await fixture.reviewer.review({ id: review.id, sources: [source], context: REVIEW_CONTEXT })
    await rm(path.dirname(fixture.sources[0].path), { recursive: true })
    const loaded = await fixture.store.read(review.id)
    const retained = await readFile(await fixture.store.sourceFile(review, review.documents[1]))
    assert({
      given: 'five related agreements uploaded over five messages',
      should: 'compare each growing set, retain original PDF bytes and keep one finding identity',
      actual: {
        counts: calls.map((call) => call.count),
        identity: review.findings[0].id === firstId,
        map: loaded?.documents.length,
        expected: loaded?.expectedDocuments,
        nativePdf: calls[4].nativePdf,
        profile: calls.every((call) => call.context.includes('Atlas, the customer')),
        original: retained.subarray(0, 8).toString(),
        decisions: loaded?.decisions,
        state: loaded?.comparison.status,
      },
      expected: {
        counts: [1, 2, 3, 4, 5],
        identity: true,
        map: 5,
        expected: 5,
        nativePdf: true,
        profile: true,
        original: '%PDF-1.4',
        decisions: [],
        state: 'current',
      },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('explicit decisions persist, but revised evidence reopens them without rewriting user history', async () => {
  const fixture = await reviewFixture()
  try {
    let review = await fixture.reviewer.review({ sources: fixture.sources.slice(0, 1), context: REVIEW_CONTEXT })
    review = await fixture.store.decide(
      review.id,
      { findingId: review.findings[0].id, action: 'accept-risk' },
      review.revision,
    )
    assert({
      given: 'the user explicitly accepts the reviewed risk',
      should: 'remove it from open issues',
      actual: openFindings(review).length,
      expected: 0,
    })
    const priorDecision = structuredClone(review.decisions[0])
    review = await fixture.reviewer.review({
      id: review.id,
      sources: fixture.sources.slice(1, 2),
      context: REVIEW_CONTEXT,
    })
    assert({
      given: 'a later agreement changes the finding',
      should: 'reopen it and preserve the actual earlier decision',
      actual: { open: openFindings(review).length, decision: review.decisions[0] },
      expected: { open: 1, decision: priorDecision },
    })
    const replacement = path.join(fixture.root, 'revision.md')
    await writeFile(replacement, '# Revised agreement\nCancellation requires 15 days notice.')
    const old = review.documents[0].id
    const registered = await fixture.reviewer.register({
      id: review.id,
      sources: [{ path: replacement, name: 'revision.md' }],
      replaces: old,
      context: REVIEW_CONTEXT,
    })
    assert({
      given: 'an explicitly revised replacement',
      should: 'retain both versions, exclude the old version from the active count and invalidate comparison',
      actual: {
        all: registered.documents.length,
        active: activeDocuments(registered).length,
        replaces: registered.documents.at(-1)?.replaces,
        pending: registered.comparison.status,
        recheck: registered.findings[0].needsRecheck,
      },
      expected: { all: 3, active: 2, replaces: old, pending: 'needed', recheck: true },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('missing coverage, omitted prior findings and invented quotes cannot silently close a review', async () => {
  const fixture = await reviewFixture()
  try {
    const initial = await fixture.reviewer.review({ sources: fixture.sources.slice(0, 1), context: REVIEW_CONTEXT })
    const incomplete = new LegalReviewer(fixture.store, async (input) => ({
      ...scriptedAnalysis(input),
      documents: [],
    }))
    const failure = await incomplete.review({ id: initial.id, sources: [], context: REVIEW_CONTEXT }).then(
      () => '',
      (error: Error) => error.message,
    )
    assert({
      given: 'a reviewer omitting a supplied agreement',
      should: 'fail without losing prior findings',
      actual: {
        failed: failure.includes('every agreement'),
        findings: (await fixture.store.read(initial.id))?.findings.length,
      },
      expected: { failed: true, findings: 1 },
    })
    const omitted = new LegalReviewer(fixture.store, async (input) => ({ ...scriptedAnalysis(input), findings: [] }))
    const stale = await omitted.review({ id: initial.id, sources: [], context: REVIEW_CONTEXT })
    assert({
      given: 'an omitted prior issue',
      should: 'keep it open for another review',
      actual: [stale.findings.length, stale.findings[0].needsRecheck, stale.comparison.status],
      expected: [1, true, 'needed'],
    })
    const fabricated = new LegalReviewer(fixture.store, async (input) => {
      const result = scriptedAnalysis(input)
      result.findings[0].evidence[0].quote = 'The customer accepted all risks.'
      return result
    })
    const uncertain = await fabricated.review({ id: initial.id, sources: [], context: REVIEW_CONTEXT })
    assert({
      given: 'an unsupported quote',
      should: 'mark it unverified and never infer a user decision',
      actual: {
        verification: uncertain.findings[0].evidence[0].verification,
        assessment: uncertain.findings[0].assessment,
        decisions: uncertain.decisions,
      },
      expected: { verification: 'unverified', assessment: 'uncertain', decisions: [] },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('source integrity and a concurrently changed review prevent stale analysis from replacing saved work', async () => {
  const fixture = await reviewFixture()
  try {
    const initial = await fixture.reviewer.review({ sources: fixture.sources.slice(0, 1), context: REVIEW_CONTEXT })
    let started!: () => void
    let finish!: () => void
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    const release = new Promise<void>((resolve) => {
      finish = resolve
    })
    const slow = new LegalReviewer(fixture.store, async (input) => {
      started()
      await release
      return scriptedAnalysis(input)
    })
    const work = slow.review({ id: initial.id, sources: [], context: REVIEW_CONTEXT }).then(
      () => '',
      (error: Error) => error.message,
    )
    await running
    await fixture.store.decide(initial.id, { findingId: initial.findings[0].id, action: 'ask-team' }, initial.revision)
    finish()
    const failure = await work
    assert({
      given: 'the user updates a review while analysis is running',
      should: 'preserve the decision and refuse the obsolete result',
      actual: {
        failed: failure.includes('changed during review'),
        decisions: (await fixture.store.read(initial.id))?.decisions.length,
      },
      expected: { failed: true, decisions: 1 },
    })
    await writeFile(await fixture.store.sourceFile(initial, initial.documents[0]), 'Altered source text')
    const tampered = await fixture.reviewer.review({ id: initial.id, sources: [], context: REVIEW_CONTEXT }).then(
      () => '',
      (error: Error) => error.message,
    )
    assert({
      given: 'an original copy changed after its review',
      should: 'require a new version and keep prior findings',
      actual: {
        failed: tampered.includes('changed. Add it as a new version'),
        findings: (await fixture.store.read(initial.id))?.findings.length,
      },
      expected: { failed: true, findings: 1 },
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
