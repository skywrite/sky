/**
 * The context segment of the system prompt: the ambient day (prices,
 * health), the activity markdown ChatContext assembles, and the day anchor
 * that closes it. It is kept as its own prompt segment, never concatenated
 * onto the base prompt, so each gets its own prompt-cache breakpoint — a
 * context change re-writes only this segment while the base prompt stays
 * cached for the session.
 */

import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * What the day looks like before any document is retrieved. Structural on
 * purpose: the host gathers these however it does (the CLI from the
 * summary pipeline) and the session only formats them.
 */
export interface AmbientContext {
  today: { date: string; dayOfWeek: string }
  health: Array<{ date: string; data: HealthSummary }>
  prices: Array<{ date: string; data: { prices: Array<{ symbol: string; value: number }> } }>
}

export interface HealthSummary {
  sleep?: { range: string; duration: string }
  weight?: string
  strength?: Array<{ lbs: string; duration?: string }>
  work?: { duration: string }
}

function formatHealthSection(health: AmbientContext['health']): string {
  if (health.length === 0) return '(No health data available)'

  const lines: string[] = []
  for (const { date, data } of health) {
    const parts: string[] = []
    if (data.sleep) parts.push(`Sleep: ${data.sleep.range} (${data.sleep.duration} hrs)`)
    if (data.weight) parts.push(`Weight: ${data.weight} lbs`)
    if (data.strength) {
      const sessions = data.strength.map((s) => `${s.lbs} lbs${s.duration ? `, ${s.duration} mins` : ''}`).join('; ')
      parts.push(`Strength: ${sessions}`)
    }
    if (data.work) parts.push(`Work: ${data.work.duration} hrs`)
    if (parts.length > 0) lines.push(`- **${date}**: ${parts.join(' | ')}`)
  }
  return lines.join('\n')
}

function formatPriceSection(prices: AmbientContext['prices']): string {
  if (prices.length === 0) return '(No price data available)'

  const lines: string[] = []
  for (const { date, data } of prices) {
    const parts = data.prices.map((p) => {
      const formatted =
        p.value >= 1000 ? p.value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.value.toFixed(2)
      return `${p.symbol}: $${formatted}`
    })
    if (parts.length > 0) lines.push(`- **${date}**: ${parts.join(' | ')}`)
  }
  return lines.join('\n')
}

/**
 * The day restated where the model reads it last. The `(TODAY)` labels sit
 * hundreds of thousands of tokens upstream of the question, and a model
 * that loses the anchor calls this morning "yesterday" and this evening
 * "last night". Constant for the session, so it never disturbs the
 * segment's prompt cache.
 */
function formatTodaySection(today: AmbientContext['today']): string {
  let yesterday = 'the day before'
  try {
    const prev = PlainDate.from(today.date).addDays(-1)
    yesterday = `${prev.dayLong} ${prev.ymd}`
  } catch {
    // Malformed date: the label semantics still stand without the second date.
  }
  return [
    '## Today',
    '',
    `${today.dayOfWeek} ${today.date} is today, the notebook date. Documents labeled (TODAY) are from today; (yesterday) is ${yesterday}. The newest \`[Time: ...]\` message stamp is the exact current time.`,
  ].join('\n')
}

export function buildContextPrompt(ambient: AmbientContext, activityMarkdown: string | null): string {
  return [
    `# Context for ${ambient.today.date} (${ambient.today.dayOfWeek})`,
    '',
    '## Prices',
    '',
    formatPriceSection(ambient.prices),
    '',
    '## Health',
    '',
    formatHealthSection(ambient.health),
    '',
    '## Activity',
    '',
    activityMarkdown ?? '(No activity recorded)',
    '',
    formatTodaySection(ambient.today),
  ].join('\n')
}
