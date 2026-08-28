/**
 * The context segment of the system prompt: the ambient day (prices,
 * health) and the activity markdown ChatContext assembles. It is kept as
 * its own prompt segment, never concatenated onto the base prompt, so each
 * gets its own prompt-cache breakpoint — a context change re-writes only
 * this segment while the base prompt stays cached for the session.
 */

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
  ].join('\n')
}
