import type { SkySettings, WorkstreamRun } from '#lib/workstreams/types.ts'

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
const failed = (run: WorkstreamRun) => run.status === 'failed' || run.status === 'interrupted'

/** A failure is one current message; successful context may remain alongside it. */
export function workstreamSkyMessage(
  sky: Pick<SkySettings, 'lastSummary' | 'error'>,
  runs: WorkstreamRun[],
): { summary: string; error: string } {
  if (runs.some((run) => run.status === 'running')) return { summary: '', error: '' }
  const latest = runs[0]
  const error =
    sky.error || (latest && failed(latest) ? latest.error || latest.summary || 'Sky could not finish this review.' : '')
  const failureTexts = new Set(
    [
      error,
      ...runs
        .filter(failed)
        .flatMap((run) => [run.summary ?? '', run.error ?? '', `${run.summary ?? ''} ${run.error ?? ''}`]),
    ]
      .map(normalize)
      .filter(Boolean),
  )
  const summary = [
    sky.lastSummary,
    ...(latest && !failed(latest) ? [latest.summary] : []),
    ...runs.filter((run) => run.status === 'completed').map((run) => run.summary),
  ].find((text) => text?.trim() && !failureTexts.has(normalize(text)))
  return { summary: summary ?? '', error }
}
