export default function formatSlackTimestamp(ts: string, timezone: string): string {
  const seconds = Number.parseFloat(ts)
  if (!Number.isFinite(seconds)) return ts

  const epochMs = Math.round(seconds * 1000)
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    timeZone: timezone,
  })
  const parts = formatter.formatToParts(epochMs)
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  const hour = parts.find((p) => p.type === 'hour')?.value
  const minute = parts.find((p) => p.type === 'minute')?.value

  if (!year || !month || !day || !hour || !minute) return ts
  return `${year}-${month}-${day} ${hour}:${minute}`
}
