import { RunSchema } from '#lib/workstreams/types.ts'
import { assert, test } from '#test'
import { workstreamSkyMessage } from './workstreamsSkyMessage.ts'

const error = 'Sky could not complete this attempt. The response was incomplete. Please try again.'
const failed = RunSchema.parse({
  id: 'attempt',
  workstreamId: 'atlas-pilot',
  status: 'failed',
  trigger: 'manual',
  started: '2025-03-15 12:00',
  summary: 'Sky could not complete this attempt.',
  error: 'The response was incomplete. Please try again.',
})
const successful = RunSchema.parse({
  id: 'prepared',
  workstreamId: 'atlas-pilot',
  status: 'completed',
  trigger: 'manual',
  started: '2025-03-14 12:00',
  summary: 'Prepared the pilot outline for your review.',
})

test('Sky brief presents a repeated current failure once', () => {
  assert({
    given: 'the runner copied the failure into both lastSummary and error',
    should: 'render only the error, including when whitespace differs between copies',
    actual: workstreamSkyMessage({ lastSummary: error.replaceAll(' ', '\n'), error }, [failed]),
    expected: { summary: '', error },
  })
})

test('Sky brief keeps useful successful context distinct from the current failure', () => {
  assert({
    given: 'a failed review after a completed outline, or a retained successful lastSummary',
    should: 'preserve the earlier successful result without repeating the failure as prose',
    actual: [
      workstreamSkyMessage({ lastSummary: error, error }, [failed, successful]),
      workstreamSkyMessage({ lastSummary: successful.summary, error }, [failed]),
    ],
    expected: [
      { summary: successful.summary, error },
      { summary: successful.summary, error },
    ],
  })
})

test('Sky brief hides stale failure messages during a new attempt', () => {
  const running = RunSchema.parse({ ...failed, id: 'retry', status: 'running', error: undefined, summary: undefined })
  assert({
    given: 'a new running attempt while the workstream still retains its previous failure',
    should: 'leave only the active working indicator visible',
    actual: workstreamSkyMessage({ lastSummary: error, error }, [running, failed, successful]),
    expected: { summary: '', error: '' },
  })
})

test('Sky brief falls back to the failed or interrupted run when machine status has not caught up', () => {
  assert({
    given: 'a current failed or interrupted run before the workstream status reflects its error',
    should: 'show the failure once rather than repeating the run summary',
    actual: [
      workstreamSkyMessage({}, [failed]),
      workstreamSkyMessage({}, [{ ...failed, status: 'interrupted' }]),
      workstreamSkyMessage({}, [successful, failed]),
    ],
    expected: [
      { summary: '', error: failed.error },
      { summary: '', error: failed.error },
      { summary: successful.summary, error: '' },
    ],
  })
})
