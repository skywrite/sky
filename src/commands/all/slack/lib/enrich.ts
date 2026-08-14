/**
 * Corpus and framing for auto-tag/auto-rel on Slack captures.
 *
 * `kind` is the noun the prompts use for what they are labeling, so a Slack
 * thread is never described to the model as a meeting (or the reverse). Shared
 * with the eval harnesses so a backtest scores the same prompt production runs.
 */
export const SLACK_ENRICH: { mediums: string[]; kind: string } = {
  mediums: ['slack'],
  kind: 'Slack conversation',
}
