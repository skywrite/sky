import { assert, test } from '#test'
import { acceptWorkstreamProposal, normalizeWorkstreamProposal } from './workstreams.tsx'
import { dayOffset } from './workstreamsCanvas.tsx'

test({ name: 'workstream capture - proposed decisions remain decisions and relationships await review' }, () => {
  const proposal = normalizeWorkstreamProposal({
    title: 'Launch Atlas',
    outcome: 'Validate the pilot with customers.',
    unknowns: ['Which customer group should participate?'],
    activities: [{ title: 'Review the supplied feedback', executor: 'sky', description: 'Prepare a useful summary.' }],
    decisions: [
      { question: 'Choose the first customer group', context: 'Use the feedback.', recommendation: 'Start small.' },
    ],
    relationships: [{ workstreamId: 'outreach', kind: 'prerequisite', reason: 'A specific approval may be needed.' }],
    subworkstreams: [
      { title: 'Customer outreach', outcome: 'Recruit a focused group.', reason: 'May need independent coordination.' },
    ],
  })
  assert({
    given: 'a model proposal containing actions, judgment, and a possible prerequisite',
    should: 'preserve the decision and propose the relationship without inventing a blocking requirement',
    actual: {
      kinds: proposal.activities.map((activity) => activity.kind),
      executors: proposal.activities.map((activity) => activity.executor),
      states: proposal.activities.map((activity) => activity.state),
      requires: proposal.activities.flatMap((activity) => activity.requires),
      recommendation: proposal.activities[1]!.recommendation,
      suggestions: proposal.proposals.map((value) => value.kind),
      relationshipKind: proposal.proposals.find((value) => value.kind === 'relation')?.relationKind,
    },
    expected: {
      kinds: ['action', 'decision'],
      executors: ['sky', 'human'],
      states: ['proposed', 'proposed'],
      requires: [],
      recommendation: 'Start small.',
      suggestions: ['subworkstream', 'relation'],
      relationshipKind: 'prerequisite',
    },
  })
  assert({
    given: 'the user explicitly creates the reviewed proposal',
    should: 'make accepted activities ready for real execution while leaving structural suggestions for review',
    actual: {
      states: acceptWorkstreamProposal(proposal).activities.map((activity) => activity.state),
      suggestions: acceptWorkstreamProposal(proposal).proposals.map((value) => value.kind),
    },
    expected: { states: ['ready', 'ready'], suggestions: ['subworkstream', 'relation'] },
  })
})

test({ name: 'workstream timeline - calendar offsets do not shift across DST or year boundaries' }, () => {
  assert({
    given: 'spring and autumn clock changes, leap day, and a year boundary',
    should: 'count calendar days independently of hours and timezone shifts',
    actual: [
      dayOffset('2026-03-07', '2026-03-09'),
      dayOffset('2026-10-31', '2026-11-02'),
      dayOffset('2024-02-28', '2024-03-01'),
      dayOffset('2026-12-31', '2027-01-02'),
      dayOffset('2027-01-02', '2026-12-31'),
    ],
    expected: [2, 2, 2, 2, -2],
  })
})

test({ name: 'workstream capture - concrete coordination survives creation as a reviewable proposal' }, () => {
  const proposal = acceptWorkstreamProposal(
    normalizeWorkstreamProposal({
      title: 'Launch Atlas',
      outcome: 'A focused pilot with useful customer feedback.',
      coordination: {
        stakeholders: [{ name: 'Jane Doe', role: 'Pilot lead', reason: 'Named in the intention.', basis: 'stated' }],
        timeline: { due: '2026-10-01', reason: 'Requested deadline.', basis: 'stated' },
        reporting: [
          {
            audience: 'Advisors',
            medium: 'email',
            cadenceDays: 7,
            detail: 'summary',
            artifacts: ['Presentation'],
            instructions: 'Summarize progress and decisions.',
            reason: 'A useful check-in cadence.',
            basis: 'suggested',
          },
        ],
      },
    }),
  )
  assert({
    given: 'people, a deadline, and a proposed reporting cadence extracted from an intention',
    should: 'keep the concrete values visible for review without configuring audience access or delivery authority',
    actual: {
      kind: proposal.proposals[0]?.kind,
      person: proposal.proposals[0]?.coordination?.stakeholders?.[0]?.name,
      due: proposal.proposals[0]?.coordination?.timeline?.due,
      cadence: proposal.proposals[0]?.coordination?.reporting?.[0]?.cadenceDays,
      appliedReporting: 'reporting' in proposal,
      authority: 'sky' in proposal,
    },
    expected: {
      kind: 'coordination',
      person: 'Jane Doe',
      due: '2026-10-01',
      cadence: 7,
      appliedReporting: false,
      authority: false,
    },
  })
})
